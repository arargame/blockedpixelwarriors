using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Gameplay;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.World;

/// <summary>Sprite clouds (CloudLayer.js): back-to-front sorted once, slow drift with wrap-around.</summary>
public sealed class CloudLayer : IRenderable
{
    private sealed class Cloud
    {
        public CloudData Data;
        public float Offset;
    }

    private readonly (BillboardBatch batch, List<Cloud> items)[] _variants;
    private bool _sorted;
    private Matrix _world;

    /// <summary>Layer transform (the backdrop's moves with the camera's travel).</summary>
    public Matrix World
    {
        get => _world;
        set
        {
            _world = value;
            foreach (var (batch, _) in _variants) batch.World = value;
        }
    }

    public CloudLayer(GraphicsDevice device, ModelLibrary models, CloudLayerData data, Matrix world, int renderOrder)
    {
        _world = world;
        _variants = new (BillboardBatch, List<Cloud>)[3];
        for (var v = 0; v < 3; v++)
        {
            var (tex, srgb) = models.Texture($"cloudPuff{v}");
            var items = v < data.Variants.Count ? data.Variants[v].Select(c => new Cloud { Data = c }).ToList() : new List<Cloud>();
            var batch = new BillboardBatch(device, tex, srgb, Math.Max(1, items.Count), false, renderOrder) { World = world };
            _variants[v] = (batch, items);
        }
    }

    /// <param name="nearFade">0..1: fade puffs near the camera (the backdrop cloud sea once the
    /// camera travels up the line: over the open bridge nothing hides it, CloudLayer.js).</param>
    public void Update(float dt, Camera3D camera, float nearFade = 0)
    {
        foreach (var (batch, items) in _variants)
        {
            if (!_sorted)
            {
                // Distances in world space (the layer may be tilted with the backdrop).
                items.Sort((a, b) => Dist(b).CompareTo(Dist(a)));
                float Dist(Cloud c) => Vector3.DistanceSquared(camera.Position, Vector3.Transform(new Vector3(c.Data.X, c.Data.Y, c.Data.Z), _world));
            }
            batch.Begin();
            foreach (var c in items)
            {
                var d = c.Data;
                c.Offset += d.Drift * dt;
                var x = d.X + c.Offset;
                if (d.Wrap > 0)
                {
                    var span = d.Wrap;
                    x = d.X + (((c.Offset + span * 0.5f) % span) + span) % span - span * 0.5f;
                }
                var tint = d.Tint == 0 ? 1 : d.Tint;
                var alpha = d.Alpha == 0 ? 1 : d.Alpha;
                if (nearFade > 0)
                {
                    var dist = Vector3.Distance(Vector3.Transform(new Vector3(x, d.Y, d.Z), _world), camera.Position);
                    var k = MathX.Clamp01((dist - 35) / 25);
                    alpha *= 1 - nearFade + nearFade * k * k * (3 - 2 * k);
                }
                batch.Push(x, d.Y, d.Z, d.Size, d.Size * (d.Aspect == 0 ? 1 : d.Aspect), tint, tint, tint, alpha);
            }
            batch.End();
        }
        _sorted = true;
    }

    public void Submit(RenderQueue queue)
    {
        foreach (var (batch, _) in _variants) queue.Add(batch);
    }
}

/// <summary>
/// Static environment (World.js facade): board, railway, islands, forests, waterfalls, sky,
/// clouds, sun glare and the weather. Everything here was exported from the web scene.
/// </summary>
public sealed class WorldScene : IRenderable
{
    private readonly List<(GpuMesh mesh, InstanceBuffer instances, Matrix world, bool shadow, RenderLayer layer, bool backdrop)> _static = new();
    private readonly Matrix _backdropHome;
    private readonly Vector3 _sunHome, _sunTargetHome;
    private readonly LightRig _lights;
    private readonly CloudLayer _clouds, _boardClouds;
    private readonly BillboardBatch _sunGlare;

    public Board Board { get; } = new();
    /// <summary>Backdrop transform: home tilt + the camera's travel (sky, islands, cloud sea).</summary>
    public Matrix Backdrop { get; private set; }
    public SnowWeather Weather { get; } = new();
    public SnowFall SnowFall { get; }
    public RailSnow RailSnow { get; }
    public FloorSnow FloorSnow { get; }

    public WorldScene(GraphicsDevice device, ModelLibrary models, SceneData scene, bool foreground, LightRig lights)
    {
        var q = scene.Backdrop.Quaternion;
        Backdrop = _backdropHome = Matrix.CreateFromQuaternion(new Quaternion(q[0], q[1], q[2], q[3])) * Matrix.CreateTranslation(MathX.V3(scene.Backdrop.Position));
        _lights = lights;
        _sunHome = lights.SunPosition;
        _sunTargetHome = lights.SunTarget;

        void AddSet(string bucket, bool shadow, RenderLayer layer)
        {
            var backdrop = bucket == "world_backdrop";
            var plain = models.Mesh(bucket);
            if (plain != null) _static.Add((plain, null, Matrix.Identity, shadow, layer, backdrop));
            if (scene.InstanceSets == null || !scene.InstanceSets.TryGetValue(bucket, out var sets)) return;
            foreach (var name in sets)
            {
                var inst = models.Instanced(name);
                if (inst != null) _static.Add((inst.Mesh, inst.Instances, inst.World, shadow, layer, backdrop));
            }
        }
        AddSet("world_static", true, RenderLayer.World);
        AddSet("world_backdrop", false, RenderLayer.World);
        if (foreground) AddSet("world_foreground", false, RenderLayer.Foreground);

        _clouds = new CloudLayer(device, models, scene.Clouds[0], Backdrop, 5);
        _boardClouds = new CloudLayer(device, models, scene.Clouds[1], Matrix.Identity, 6);

        var (glareTex, glareSrgb) = models.Texture("sunGlare");
        _sunGlare = new BillboardBatch(device, glareTex, glareSrgb, 2, true, 8) { World = Backdrop, DepthTest = false };
        var g = scene.SunGlare;
        _sunGlare.Begin();
        _sunGlare.Push(g.Position[0], g.Position[1], g.Position[2], g.Size, g.Size, g.Color[0], g.Color[1], g.Color[2], g.Color[3]);
        _sunGlare.End();

        var (glow, glowSrgb) = models.Texture("glow");
        SnowFall = new SnowFall(new BillboardBatch(device, glow, glowSrgb, 700, false, 17), Weather, Board);
        var mounds = Enumerable.Range(0, 3).Select(i => models.Mesh($"rail_snow{i}")).ToArray();
        RailSnow = new RailSnow(device, mounds, Weather, GameConfig.Track.StartZ + 1, GameConfig.Track.EndZ - 1);
        FloorSnow = new FloorSnow(device, Weather, Board);
    }

    /// <summary>
    /// Moves the "at infinity" parts by the camera's travel (World.follow): backdrop, sun shadow
    /// box (snapped to whole units) and the snowfall volume.
    /// </summary>
    public void Follow(Vector3 travel)
    {
        travel.Y = 0;
        Backdrop = _backdropHome * Matrix.CreateTranslation(travel);
        _clouds.World = Backdrop;
        _sunGlare.World = Backdrop;
        var snap = new Vector3(MathF.Round(travel.X), 0, MathF.Round(travel.Z));
        _lights.SunPosition = _sunHome + snap;
        _lights.SunTarget = _sunTargetHome + snap;
        SnowFall.Offset = travel;
    }

    public void Update(float dt, Camera3D camera)
    {
        _clouds.Update(dt, camera, MathX.Clamp01(new Vector2(Backdrop.Translation.X - _backdropHome.Translation.X, Backdrop.Translation.Z - _backdropHome.Translation.Z).Length() / 12));
        _boardClouds.Update(dt, camera);
        Weather.Update(dt);
        SnowFall.Update(dt);
    }

    public void Submit(RenderQueue queue)
    {
        foreach (var (mesh, instances, world, shadow, layer, backdrop) in _static)
            queue.Add(mesh, backdrop ? world * Matrix.CreateTranslation(Backdrop.Translation - _backdropHome.Translation) : world, DrawOverrides.None, shadow, 0, layer, instances);
        _clouds.Submit(queue);
        _boardClouds.Submit(queue);
        queue.Add(_sunGlare);
        SnowFall.Submit(queue);
        RailSnow.Submit(queue);
    }
}
