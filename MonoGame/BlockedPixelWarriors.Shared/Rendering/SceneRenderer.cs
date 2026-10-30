using BlockedPixelWarriors.Assets;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>Render layers (RenderPipeline.js LAYERS): the foreground is blurred separately.</summary>
public enum RenderLayer { World = 0, Foreground = 1 }

/// <summary>One queued mesh draw (a single material part, optionally instanced).</summary>
public struct DrawItem
{
    public GpuMesh Mesh;
    public MeshPart Part;
    public Matrix World;
    public InstanceBuffer Instances;
    public DrawOverrides Overrides;
    public int RenderOrder;
    public RenderLayer Layer;
    public bool CastShadow;
    public float SortDepth;
}

/// <summary>Anything that puts draws into the frame (Strategy: entities decide how they look).</summary>
public interface IRenderable
{
    void Submit(RenderQueue queue);
}

/// <summary>Per-frame draw lists, refilled by every <see cref="IRenderable"/> each frame.</summary>
public sealed class RenderQueue
{
    internal readonly List<DrawItem> Opaque = new(512);
    internal readonly List<DrawItem> Transparent = new(128);
    internal readonly List<BillboardBatch> Billboards = new(32);
    internal readonly List<DrawItem> ShadowCasters = new(512);

    public void Clear()
    {
        Opaque.Clear();
        Transparent.Clear();
        Billboards.Clear();
        ShadowCasters.Clear();
    }

    /// <summary>Queues every part of a mesh.</summary>
    public void Add(GpuMesh mesh, in Matrix world, in DrawOverrides overrides, bool castShadow = true, int renderOrder = 0, RenderLayer layer = RenderLayer.World, InstanceBuffer instances = null, RenderMaterial material = null)
    {
        if (mesh == null) return;
        if (instances != null && instances.Count == 0) return;
        foreach (var part in mesh.Parts)
        {
            var item = new DrawItem
            {
                Mesh = mesh,
                Part = material == null ? part : new MeshPart { Material = material, BaseVertex = part.BaseVertex, StartIndex = part.StartIndex, PrimitiveCount = part.PrimitiveCount },
                World = world,
                Instances = instances,
                Overrides = overrides,
                RenderOrder = renderOrder,
                Layer = layer,
                CastShadow = castShadow && part.Material.CastShadow && layer == RenderLayer.World,
            };
            var transparent = item.Part.Material.Transparent || overrides.ColorMul.W < 0.999f;
            (transparent ? Transparent : Opaque).Add(item);
            if (item.CastShadow) ShadowCasters.Add(item);
        }
    }

    public void Add(GpuMesh mesh, in Matrix world, bool castShadow = true) => Add(mesh, world, DrawOverrides.None, castShadow);

    /// <summary>Queues one part of a mesh (per-part tints, e.g. the checkpoint hoop turning green).</summary>
    public void AddPart(GpuMesh mesh, MeshPart part, in Matrix world, in DrawOverrides overrides, bool castShadow = true, int renderOrder = 0)
    {
        var item = new DrawItem
        {
            Mesh = mesh, Part = part, World = world, Overrides = overrides, RenderOrder = renderOrder, Layer = RenderLayer.World,
            CastShadow = castShadow && part.Material.CastShadow,
        };
        var transparent = part.Material.Transparent || overrides.ColorMul.W < 0.999f;
        (transparent ? Transparent : Opaque).Add(item);
        if (item.CastShadow) ShadowCasters.Add(item);
    }

    public void Add(BillboardBatch batch)
    {
        if (batch != null && batch.Visible && batch.Count > 0) Billboards.Add(batch);
    }
}

/// <summary>
/// Draws a frame like Three's WebGLRenderer does for this scene: sun shadow map, sky, opaque
/// meshes (grouped by material), then transparent meshes and billboards sorted by render order
/// and distance, with the blurred foreground layer and the post chain from <see cref="PostProcessor"/>.
/// </summary>
public sealed class SceneRenderer : IDisposable
{
    private readonly GraphicsDevice _device;
    private readonly LitShader _lit;
    private readonly BillboardShader _billboards;
    private readonly RenderQuality _quality;
    private RenderTarget2D _shadowMap;
    private readonly List<(int order, float depth, int seq, DrawItem? mesh, BillboardBatch batch)> _sorted = new(256);
    private Matrix _shadowViewProj;
    private Texture2D _snowMap;
    private Vector4 _snowRect = new(0, 0, 1, 1);

    private static readonly SamplerState EnvSampler = new()
    {
        Filter = TextureFilter.Linear, AddressU = TextureAddressMode.Wrap, AddressV = TextureAddressMode.Clamp, MaxMipLevel = 0,
    };

    public PostProcessor Post { get; }
    public SkyDome Sky { get; set; }
    public Matrix BackdropWorld { get; set; } = Matrix.Identity;
    public LightRig Lights { get; set; }
    public float Time { get; set; }
    public int DrawCalls { get; private set; }

    public SceneRenderer(GraphicsDevice device, AssetStore assets, RenderQuality quality, PostData post)
    {
        _device = device;
        _quality = quality;
        _lit = new LitShader(assets.Effect("Lit"));
        _billboards = new BillboardShader(assets.Effect("Billboard"));
        Post = new PostProcessor(device, assets.Effect("Post"), post, quality);
        _shadowMap = new RenderTarget2D(device, quality.ShadowMap, quality.ShadowMap, false, SurfaceFormat.Color, DepthFormat.Depth24);
        var blank = new Texture2D(device, 1, 1);
        blank.SetData(new[] { new Color(0, 0, 0, 255) });
        _snowMap = blank;
    }

    /// <summary>Settled-snow coverage for the tile floor (R channel) and its world rect.</summary>
    public void SetSnowMap(Texture2D map, Vector4 rect)
    {
        _snowMap = map;
        _snowRect = rect;
    }

    public void Render(RenderQueue queue, Camera3D camera, RenderTarget2D output, Rectangle viewport)
    {
        DrawCalls = 0;
        RenderShadows(queue);
        _lit.SetFrame(camera, Lights, _shadowViewProj, _shadowMap, _quality.ShadowMap, _snowMap, _snowRect);

        // Foreground layer first (own half-res target), composited at the end of the scene pass.
        var hasForeground = Post.HasForeground && queue.Opaque.Exists(i => i.Layer == RenderLayer.Foreground);
        if (hasForeground)
        {
            Post.BeginForeground();
            DrawOpaque(queue, RenderLayer.Foreground);
            Post.BlurForeground();
        }

        Post.BeginScene(new Color(Lights.FogColor));
        Sky?.Draw(_device, camera, BackdropWorld);
        DrawOpaque(queue, RenderLayer.World);
        DrawTransparent(queue, camera);
        if (hasForeground) Post.CompositeForeground();
        Post.Present(output, viewport);
    }

    // ---- Shadows ------------------------------------------------------------------------------

    private void RenderShadows(RenderQueue queue)
    {
        var s = Lights.Shadow;
        var view = Matrix.CreateLookAt(Lights.SunPosition, Lights.SunTarget, Vector3.Up);
        var proj = Matrix.CreateOrthographicOffCenter(s.Left, s.Right, s.Bottom, s.Top, s.Near, s.Far);
        _shadowViewProj = view * proj;
        _device.SetRenderTarget(_shadowMap);
        _device.Clear(ClearOptions.Target | ClearOptions.DepthBuffer, Color.White, 1, 0);
        _device.BlendState = BlendState.Opaque;
        _device.DepthStencilState = DepthStencilState.Default;
        _lit.SetShadowCaster(_shadowViewProj);
        foreach (var item in queue.ShadowCasters)
        {
            _device.RasterizerState = item.Part.Material.DoubleSided ? RasterizerState.CullNone : RenderStates.CullFront;
            _lit.SetWorld(item.World);
            _lit.ApplyShadow(item.Instances != null);
            Draw(item);
        }
    }

    // ---- Opaque -------------------------------------------------------------------------------

    private void DrawOpaque(RenderQueue queue, RenderLayer layer)
    {
        _device.BlendState = BlendState.Opaque;
        _device.DepthStencilState = DepthStencilState.Default;
        RenderMaterial current = null;
        foreach (var item in queue.Opaque)
        {
            if (item.Layer != layer) continue;
            DrawLit(item, ref current);
        }
    }

    private void DrawLit(in DrawItem item, ref RenderMaterial current)
    {
        var m = item.Part.Material;
        _lit.SetMaterial(m, item.Overrides, Time);
        if (item.Instances != null) _lit.ForceVertexColor(true, m);
        current = m;
        _lit.SetWorld(item.World);
        _device.RasterizerState = m.DoubleSided ? RasterizerState.CullNone : RenderStates.CullBack;
        _device.SamplerStates[0] = m.Tile != null ? SamplerState.AnisotropicWrap : SamplerState.LinearWrap;
        _device.SamplerStates[1] = SamplerState.LinearWrap;
        _device.SamplerStates[2] = SamplerState.PointClamp;
        _device.SamplerStates[3] = SamplerState.LinearClamp;
        _device.SamplerStates[4] = EnvSampler;
        _lit.ApplyLit(item.Instances != null, m.Tile != null);
        Draw(item);
    }

    // ---- Transparent --------------------------------------------------------------------------

    private void DrawTransparent(RenderQueue queue, Camera3D camera)
    {
        _sorted.Clear();
        var seq = 0;
        var forward = camera.Forward;
        foreach (var item in queue.Transparent)
        {
            if (item.Layer != RenderLayer.World) continue;
            var depth = Vector3.Dot(item.World.Translation - camera.Position, forward);
            _sorted.Add((item.RenderOrder, depth, seq++, item, null));
        }
        foreach (var b in queue.Billboards)
        {
            if (b.Layer != (int)RenderLayer.World) continue;
            var depth = Vector3.Dot(b.World.Translation - camera.Position, forward);
            _sorted.Add((b.RenderOrder, depth, seq++, null, b));
        }
        // Three's reversePainterSortStable: render order, then far to near, then creation order.
        _sorted.Sort((a, b) => a.order != b.order ? a.order.CompareTo(b.order) : a.depth != b.depth ? b.depth.CompareTo(a.depth) : a.seq.CompareTo(b.seq));
        RenderMaterial current = null;
        foreach (var entry in _sorted)
        {
            if (entry.batch != null)
            {
                _billboards.Draw(_device, entry.batch, camera, Lights);
                DrawCalls++;
                current = null;
                continue;
            }
            var item = entry.mesh.Value;
            var m = item.Part.Material;
            _device.BlendState = m.Blend == BlendMode.Additive ? RenderStates.AdditiveBlend : RenderStates.NormalBlend;
            _device.DepthStencilState = m.DepthWrite ? DepthStencilState.Default : DepthStencilState.DepthRead;
            DrawLit(item, ref current);
        }
    }

    private void Draw(in DrawItem item)
    {
        var mesh = item.Mesh;
        var part = item.Part;
        if (item.Instances != null)
        {
            _device.SetVertexBuffers(new VertexBufferBinding(mesh.Vertices, part.BaseVertex, 0), new VertexBufferBinding(item.Instances.Buffer, 0, 1));
            _device.Indices = mesh.Indices;
            _device.DrawInstancedPrimitives(PrimitiveType.TriangleList, 0, part.StartIndex, part.PrimitiveCount, item.Instances.Count);
        }
        else
        {
            _device.SetVertexBuffer(mesh.Vertices);
            _device.Indices = mesh.Indices;
            _device.DrawIndexedPrimitives(PrimitiveType.TriangleList, part.BaseVertex, part.StartIndex, part.PrimitiveCount);
        }
        DrawCalls++;
    }

    public void Dispose()
    {
        _shadowMap.Dispose();
        Post.Dispose();
    }
}
