using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>
/// Camera-facing quads in one draw call (port of BillboardBatch.js). Quads are rebuilt each frame
/// with begin/push/end into a dynamic vertex buffer (4 vertices per quad, works on every GLES
/// device without instancing) and expanded in the vertex shader.
/// </summary>
public sealed class BillboardBatch : IDisposable
{
    private readonly BillboardVertex[] _vertices;
    private readonly DynamicVertexBuffer _vb;
    private readonly IndexBuffer _ib;
    private static readonly Vector2[] Corners = { new(-0.5f, 0.5f), new(0.5f, 0.5f), new(0.5f, -0.5f), new(-0.5f, -0.5f) };

    public Texture2D Texture;
    public bool TextureSrgb;
    public bool Additive;
    public bool Fog;
    public bool DepthTest = true;
    public bool DepthWrite;
    public int RenderOrder;
    /// <summary>Quad anchor offset: (0, -0.5) hangs the quad below its point (anchorTop).</summary>
    public Vector2 Anchor;
    /// <summary>Object transform (identity, or the tilted backdrop for far clouds / sun glare).</summary>
    public Matrix World = Matrix.Identity;
    public int Layer;
    public bool Visible = true;
    public int Capacity { get; }
    public int Count { get; private set; }

    public BillboardBatch(GraphicsDevice device, Texture2D texture, bool srgb, int capacity, bool additive = false, int renderOrder = 10, bool anchorTop = false)
    {
        Capacity = Math.Min(capacity, 16383);
        Texture = texture;
        TextureSrgb = srgb;
        Additive = additive;
        RenderOrder = renderOrder;
        Anchor = anchorTop ? new Vector2(0, -0.5f) : Vector2.Zero;
        _vertices = new BillboardVertex[Capacity * 4];
        _vb = new DynamicVertexBuffer(device, VertexFormats.Billboard, _vertices.Length, BufferUsage.WriteOnly);
        var indices = new ushort[Capacity * 6];
        for (var i = 0; i < Capacity; i++)
        {
            var v = (ushort)(i * 4);
            indices[i * 6] = v;
            indices[i * 6 + 1] = (ushort)(v + 1);
            indices[i * 6 + 2] = (ushort)(v + 2);
            indices[i * 6 + 3] = v;
            indices[i * 6 + 4] = (ushort)(v + 2);
            indices[i * 6 + 5] = (ushort)(v + 3);
        }
        _ib = new IndexBuffer(device, IndexElementSize.SixteenBits, indices.Length, BufferUsage.WriteOnly);
        _ib.SetData(indices);
    }

    public void Begin() => Count = 0;

    /// <summary>Appends one quad; false when the batch is full.</summary>
    public bool Push(float x, float y, float z, float width, float height, float r, float g, float b, float a, float rotation = 0, float dx = 0, float dy = 0, float dz = 0)
    {
        if (Count >= Capacity) return false;
        var o = Count++ * 4;
        var center = new Vector3(x, y, z);
        var size = new Vector3(width, height, rotation);
        var color = new Vector4(r, g, b, a);
        var dir = new Vector3(dx, dy, dz);
        for (var k = 0; k < 4; k++)
        {
            ref var v = ref _vertices[o + k];
            v.Center = center;
            v.Corner = Corners[k];
            v.Size = size;
            v.Color = color;
            v.Dir = dir;
        }
        return true;
    }

    public void End()
    {
        if (Count > 0) _vb.SetData(_vertices, 0, Count * 4, SetDataOptions.Discard);
    }

    public void Draw(GraphicsDevice device)
    {
        if (Count == 0) return;
        device.SetVertexBuffer(_vb);
        device.Indices = _ib;
        device.DrawIndexedPrimitives(PrimitiveType.TriangleList, 0, 0, Count * 2);
    }

    public void Dispose()
    {
        _vb.Dispose();
        _ib.Dispose();
    }
}

/// <summary>Billboard.mgfx front-end.</summary>
public sealed class BillboardShader
{
    private readonly Effect _fx;
    private readonly EffectParameter _view, _projection, _anchor, _additive, _mapSrgb, _fogColor, _fogRange, _map;

    public BillboardShader(Effect fx)
    {
        _fx = fx;
        var p = fx.Parameters;
        _view = p["View"];
        _projection = p["Projection"];
        _anchor = p["Anchor"];
        _additive = p["Additive"];
        _mapSrgb = p["MapSrgb"];
        _fogColor = p["FogColor"];
        _fogRange = p["FogRange"];
        _map = p["Map"];
    }

    private static readonly BlendState AdditiveOne = new()
    {
        ColorSourceBlend = Blend.One, ColorDestinationBlend = Blend.One, ColorBlendFunction = BlendFunction.Add,
        AlphaSourceBlend = Blend.One, AlphaDestinationBlend = Blend.One, AlphaBlendFunction = BlendFunction.Add,
    };

    public void Draw(GraphicsDevice device, BillboardBatch batch, Camera3D camera, LightRig lights)
    {
        if (!batch.Visible || batch.Count == 0) return;
        _view.SetValue(batch.World * camera.View);
        _projection.SetValue(camera.Projection);
        _anchor.SetValue(batch.Anchor);
        _additive.SetValue(batch.Additive ? 1f : 0f);
        _mapSrgb.SetValue(batch.TextureSrgb ? 1f : 0f);
        _fogColor.SetValue(lights.FogColor);
        _fogRange.SetValue(batch.Fog ? new Vector2(lights.FogNear, lights.FogFar) : new Vector2(1e8f, 2e8f));
        _map.SetValue(batch.Texture);
        device.BlendState = batch.Additive ? AdditiveOne : RenderStates.NormalBlend;
        device.DepthStencilState = !batch.DepthTest ? DepthStencilState.None : batch.DepthWrite ? DepthStencilState.Default : DepthStencilState.DepthRead;
        device.RasterizerState = RasterizerState.CullNone;
        device.SamplerStates[0] = SamplerState.LinearClamp;
        _fx.CurrentTechnique.Passes[0].Apply();
        batch.Draw(device);
    }
}

/// <summary>Shared render states with Three.js blending semantics.</summary>
public static class RenderStates
{
    /// <summary>Three NormalBlending (straight alpha).</summary>
    public static readonly BlendState NormalBlend = new()
    {
        ColorSourceBlend = Blend.SourceAlpha, ColorDestinationBlend = Blend.InverseSourceAlpha,
        AlphaSourceBlend = Blend.One, AlphaDestinationBlend = Blend.InverseSourceAlpha,
    };

    /// <summary>Three AdditiveBlending (src * alpha + dst).</summary>
    public static readonly BlendState AdditiveBlend = new()
    {
        ColorSourceBlend = Blend.SourceAlpha, ColorDestinationBlend = Blend.One,
        AlphaSourceBlend = Blend.SourceAlpha, AlphaDestinationBlend = Blend.One,
    };

    /// <summary>Premultiplied "over" (foreground blur composite).</summary>
    public static readonly BlendState PremultipliedOver = new()
    {
        ColorSourceBlend = Blend.One, ColorDestinationBlend = Blend.InverseSourceAlpha,
        AlphaSourceBlend = Blend.One, AlphaDestinationBlend = Blend.InverseSourceAlpha,
    };

    /// <summary>Plain add (bloom onto the frame).</summary>
    public static readonly BlendState Add = new()
    {
        ColorSourceBlend = Blend.One, ColorDestinationBlend = Blend.One,
        AlphaSourceBlend = Blend.One, AlphaDestinationBlend = Blend.One,
    };

    /// <summary>Front faces of Three geometry (CCW) are kept: cull clockwise.</summary>
    public static readonly RasterizerState CullBack = RasterizerState.CullClockwise;
    /// <summary>Shadow pass renders back faces (Three's default shadowSide for FrontSide).</summary>
    public static readonly RasterizerState CullFront = RasterizerState.CullCounterClockwise;
}
