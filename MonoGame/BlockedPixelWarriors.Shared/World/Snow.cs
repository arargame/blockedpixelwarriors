using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Gameplay;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.World;

/// <summary>
/// Shared weather state (Snow.js SnowWeather): light snowfall that comes and goes in slow waves
/// with sudden gusts. Intensity (0..1) drives the flakes and how fast snow builds up.
/// </summary>
public sealed class SnowWeather
{
    public float Time;
    public float Intensity = 0.6f;
    public float Gust;
    private float _gustTimer = 12 + Rng.Shared.Next() * 15;
    private float _gustLength;

    public void Update(float dt)
    {
        Time += dt;
        var w = MathF.Sin(Time * 0.05f) * 0.6f + MathF.Sin(Time * 0.13f + 1.3f) * 0.4f;
        var baseline = Math.Clamp(0.45f + w * 0.55f, 0, 1);
        _gustTimer -= dt;
        if (_gustTimer <= 0)
        {
            _gustLength = 5 + Rng.Shared.Next() * 7;
            _gustTimer = _gustLength + 15 + Rng.Shared.Next() * 25;
        }
        _gustLength -= dt;
        Gust += ((_gustLength > 0 ? 1 : 0) - Gust) * MathX.Damp(1.2f, dt);
        Intensity = MathF.Max(baseline, Gust);
    }
}

/// <summary>Very light snowfall: soft flakes drifting through a volume around the board.</summary>
public sealed class SnowFall : IRenderable
{
    private struct Flake
    {
        public float X, Y, Z, Speed, Size, Phase, Sway, Threshold;
    }

    private readonly SnowWeather _weather;
    private readonly Flake[] _flakes;
    private readonly BillboardBatch _batch;
    private readonly float _x0, _x1, _z0, _z1, _y0 = -2, _y1 = 14;
    private float _time;

    public SnowFall(BillboardBatch batch, SnowWeather weather, Board board)
    {
        _batch = batch;
        _weather = weather;
        _x0 = board.MinX - 8;
        _x1 = board.MaxX + 8;
        _z0 = board.MinZ - 8;
        _z1 = board.MaxZ + 6;
        var rng = new Rng(4242);
        _flakes = new Flake[batch.Capacity];
        for (var i = 0; i < _flakes.Length; i++)
        {
            _flakes[i] = new Flake
            {
                X = rng.Range(_x0, _x1), Y = rng.Range(_y0, _y1), Z = rng.Range(_z0, _z1),
                Speed = rng.Range(0.6f, 1.3f), Size = rng.Range(0.08f, 0.15f), Phase = rng.Range(0, 6.28f),
                Sway = rng.Range(0.2f, 0.6f), Threshold = rng.Next(),
            };
        }
    }

    /// <summary>Camera travel: the snowfall volume moves along with the camera (stage 2).</summary>
    public Vector3 Offset;

    public void Update(float dt)
    {
        _time += dt;
        var visible = _weather.Intensity;
        var gust = _weather.Gust;
        _batch.Begin();
        for (var i = 0; i < _flakes.Length; i++)
        {
            ref var f = ref _flakes[i];
            f.Y -= f.Speed * (1 + gust * 2.2f) * dt;
            f.X += gust * 2.5f * dt;
            f.X += MathF.Sin(_time * 0.8f + f.Phase) * f.Sway * dt + 0.15f * dt;
            f.Z += MathF.Cos(_time * 0.6f + f.Phase) * f.Sway * 0.5f * dt;
            if (f.Y < _y0)
            {
                f.Y = _y1;
                f.X = _x0 + Rng.Shared.Next() * (_x1 - _x0);
                f.Z = _z0 + Rng.Shared.Next() * (_z1 - _z0);
            }
            if (f.X > _x1) f.X = _x0;
            if (f.Threshold > visible) continue;
            _batch.Push(f.X + Offset.X, f.Y, f.Z + Offset.Z, f.Size, f.Size, 1.25f, 1.28f, 1.35f, 0.85f);
        }
        _batch.End();
    }

    public void Submit(RenderQueue queue) => queue.Add(_batch);
}

/// <summary>
/// Snow lying on the railway inside the board (Snow.js RailSnow): each sleeper span builds up
/// snow while it snows and the train plows it away with a spray off the rails.
/// </summary>
public sealed class RailSnow : IRenderable
{
    private sealed class Span
    {
        public float Z, Cap, Depth, Cooldown, Rate, Rot;
        public int Variant;
    }

    private readonly SnowWeather _weather;
    private readonly List<Span> _spans = new();
    private readonly GpuMesh[] _meshes;
    private readonly InstanceBuffer[] _instances;
    private readonly Rng _rng = new(9090);
    private float _sprayTimer;
    private const float Spacing = 0.72f;

    public RailSnow(GraphicsDevice device, GpuMesh[] meshes, SnowWeather weather, float z0, float z1)
    {
        _weather = weather;
        _meshes = meshes;
        var count = (int)MathF.Floor((z1 - z0) / Spacing);
        float Patch(int i) => MathF.Sin(i * 0.37f + _rng.Next() * 0.4f) * 0.5f + MathF.Sin(i * 0.11f + 2.1f) * 0.35f + _rng.Range(-0.3f, 0.3f);
        for (var i = 0; i < count; i++)
        {
            _spans.Add(new Span
            {
                Z = z0 + (i + 0.5f) * Spacing,
                Cap = Math.Clamp(0.35f + Patch(i), 0, 1),
                Rate = _rng.Range(0.4f, 1.4f),
                Variant = _rng.Int(0, 2),
                Rot = _rng.Chance(0.5f) ? 0 : MathF.PI,
            });
        }
        _instances = meshes.Select(_ => new InstanceBuffer(device, count, true)).ToArray();
        foreach (var s in _spans) s.Depth = s.Cap * _rng.Range(0.3f, 0.9f);
        Write();
    }

    public void Update(float dt, Train train, Effects effects)
    {
        var snowing = _weather.Intensity;
        var capScale = 0.18f + 0.82f * MathX.SmoothStep(0.1f, 0.8f, snowing);
        var build = 0.01f + 0.04f * snowing;
        float headZ = float.NegativeInfinity, tailZ = float.NegativeInfinity;
        if (train != null)
        {
            headZ = train.MaxZ + (train.Dir > 0 ? 0.6f : 0);
            tailZ = train.MinZ - (train.Dir < 0 ? 0.6f : 0);
        }
        float plowed = 0;
        foreach (var s in _spans)
        {
            if (s.Z <= headZ && s.Z >= tailZ)
            {
                var before = s.Depth;
                s.Depth = s.Depth < 0.04f ? 0 : s.Depth * MathF.Exp(-11 * dt);
                s.Cooldown = _rng.Range(2, 9);
                if (train.Dir > 0 ? s.Z > headZ - 1.6f : s.Z < tailZ + 1.6f) plowed += before - s.Depth;
                if (before > 0.05f && Rng.Shared.Next() < dt * 3)
                {
                    effects.Smoke.Emit(new ParticleSpec
                    {
                        Position = new Vector3(GameConfig.Track.X + (Rng.Shared.Next() - 0.5f) * 2, 0.5f, s.Z), Velocity = new Vector3(0, 1.2f, 0), Drag = 1,
                        Life = 0.9f, Size0 = 0.4f, Size1 = 1.3f, Aspect = 1, Color0 = new Vector4(1.2f, 1.22f, 1.26f, 0.5f), Color1 = new Vector4(1.2f, 1.2f, 1.25f, 0), HasColor1 = true,
                    });
                }
            }
            else if (s.Cooldown > 0)
            {
                s.Cooldown -= dt;
                if (s.Cooldown <= 0) s.Cap = Math.Clamp(s.Cap + _rng.Range(-0.35f, 0.35f), 0, 1);
            }
            else
            {
                var target = s.Cap * capScale;
                s.Depth = s.Depth < target ? MathF.Min(target, s.Depth + build * s.Rate * dt) : MathF.Max(target, s.Depth - 0.02f * dt);
            }
        }
        _sprayTimer -= dt;
        if (train != null && plowed > 0.002f && _sprayTimer <= 0)
        {
            _sprayTimer = 0.03f;
            var n = Math.Min(6, 1 + (int)MathF.Floor(plowed * 140));
            var r = Rng.Shared;
            for (var i = 0; i < n; i++)
            {
                var side = r.Chance(0.5f) ? -1 : 1;
                effects.Smoke.Emit(new ParticleSpec
                {
                    Position = new Vector3(GameConfig.Track.X + side * r.Range(0.9f, 1.5f), 0.45f, train.HeadZ + train.Dir * r.Range(0.2f, 0.9f)),
                    Velocity = new Vector3(side * r.Range(2.5f, 5), r.Range(1.5f, 3.5f), train.Dir * (train.Speed + r.Range(0.5f, 2))), Drag = 1.6f, Gravity = 2.5f,
                    Life = r.Range(0.5f, 0.9f), Size0 = 0.3f, Size1 = r.Range(0.9f, 1.5f), Aspect = 1,
                    Color0 = new Vector4(1.3f, 1.34f, 1.4f, 0.95f), Color1 = new Vector4(1.25f, 1.3f, 1.35f, 0), HasColor1 = true,
                });
            }
        }
        Write();
    }

    private void Write()
    {
        foreach (var b in _instances) b.Count = 0;
        foreach (var s in _spans)
        {
            if (s.Depth < 0.04f) continue;
            var m = Matrix.CreateScale(0.55f + s.Depth * 0.45f, 0.25f + s.Depth * 1.1f, 0.75f + s.Depth * 0.25f)
                * Matrix.CreateRotationY(s.Rot) * Matrix.CreateTranslation(GameConfig.Track.X, 0.3f, s.Z);
            _instances[s.Variant].Add(m, Vector4.One);
        }
        foreach (var b in _instances) b.Upload();
    }

    public void Submit(RenderQueue queue)
    {
        for (var i = 0; i < _meshes.Length; i++)
            if (_meshes[i] != null) queue.Add(_meshes[i], Matrix.Identity, DrawOverrides.None, false, 0, RenderLayer.World, _instances[i]);
    }
}

/// <summary>
/// Light snow settling on the tile floor (Snow.js FloorSnow): a coarse coverage grid simulated
/// on the CPU and uploaded as a texture that the tile shader blends in.
/// </summary>
public sealed class FloorSnow
{
    private readonly SnowWeather _weather;
    private readonly Board _board;
    private readonly int _w, _h, _res;
    private readonly float[] _depth, _warm, _cap;
    private readonly Color[] _pixels;
    private float _uploadTimer;

    public Texture2D Texture { get; }
    public Vector4 Rect { get; }

    public FloorSnow(GraphicsDevice device, SnowWeather weather, Board board, int res = 6)
    {
        _weather = weather;
        _board = board;
        _res = res;
        _w = (int)MathF.Ceiling((board.MaxX - board.MinX) * res);
        _h = (int)MathF.Ceiling((board.MaxZ - board.MinZ) * res);
        var n = _w * _h;
        _depth = new float[n];
        _warm = new float[n];
        _cap = new float[n];
        var rng = new Rng(777);
        const int grid = 10;
        var gw = (int)MathF.Ceiling(_w / (float)grid) + 2;
        var gh = (int)MathF.Ceiling(_h / (float)grid) + 2;
        var g1 = new float[gw * gh];
        for (var i = 0; i < g1.Length; i++) g1[i] = rng.Next();
        var g2 = new float[gw * gh];
        for (var i = 0; i < g2.Length; i++) g2[i] = rng.Next();
        float Sample(float[] g, int x, int y)
        {
            float fx = x / (float)grid, fy = y / (float)grid;
            int ix = (int)MathF.Floor(fx), iy = (int)MathF.Floor(fy);
            float tx = fx - ix, ty = fy - iy;
            float sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
            float a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
            return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        }
        for (var y = 0; y < _h; y++)
        {
            for (var x = 0; x < _w; x++)
            {
                var i = y * _w + x;
                _warm[i] = 0.5f + Sample(g1, x, y) * 1.1f + rng.Range(0, 0.15f);
                _cap[i] = Math.Clamp(0.1f + Sample(g2, x, y) * 0.65f, 0, 0.7f);
                _depth[i] = _cap[i] * 0.4f * rng.Next();
            }
        }
        _pixels = new Color[n];
        Texture = new Texture2D(device, _w, _h, false, SurfaceFormat.Color);
        Rect = new Vector4(board.MinX, board.MinZ, board.MaxX - board.MinX, board.MaxZ - board.MinZ);
        Upload();
    }

    /// <summary>Things that blow snow off the floor: rotor downwash (x, z, radius, rate, puffs).</summary>
    public readonly record struct Clearer(float X, float Z, float R, float Rate, bool Puffs);

    public void Update(float dt, ReadOnlySpan<Clearer> clearers, Effects effects)
    {
        var I = _weather.Intensity;
        var d = _depth;
        var w = _w;
        var n = d.Length;
        var r = Rng.Shared;
        var hits = (int)MathF.Floor(n * 0.07f * MathF.Pow(I, 1.6f) * dt + r.Next());
        for (var k = 0; k < hits; k++)
        {
            var i = (int)(r.Next() * n);
            var add = 0.18f + r.Next() * 0.22f;
            d[i] = MathF.Min(_cap[i], d[i] + add);
            if (i + 1 < n) d[i + 1] = MathF.Min(_cap[i + 1], d[i + 1] + add * 0.3f);
            if (i - 1 >= 0) d[i - 1] = MathF.Min(_cap[i - 1], d[i - 1] + add * 0.3f);
            if (i + w < n) d[i + w] = MathF.Min(_cap[i + w], d[i + w] + add * 0.3f);
            if (i - w >= 0) d[i - w] = MathF.Min(_cap[i - w], d[i - w] + add * 0.3f);
        }
        var melt = (0.008f + 0.05f * (1 - I) * (1 - I)) * dt;
        for (var i = 0; i < n; i++)
            if (d[i] > 0) d[i] = MathF.Max(0, d[i] - melt * _warm[i]);
        foreach (var c in clearers)
        {
            var x0 = Math.Max(0, (int)MathF.Floor((c.X - c.R - _board.MinX) * _res));
            var x1 = Math.Min(w - 1, (int)MathF.Ceiling((c.X + c.R - _board.MinX) * _res));
            var y0 = Math.Max(0, (int)MathF.Floor((c.Z - c.R - _board.MinZ) * _res));
            var y1 = Math.Min(_h - 1, (int)MathF.Ceiling((c.Z + c.R - _board.MinZ) * _res));
            float blown = 0;
            for (var y = y0; y <= y1; y++)
            {
                for (var x = x0; x <= x1; x++)
                {
                    var wx = _board.MinX + (x + 0.5f) / _res - c.X;
                    var wz = _board.MinZ + (y + 0.5f) / _res - c.Z;
                    var f = 1 - MathF.Sqrt(wx * wx + wz * wz) / c.R;
                    if (f <= 0) continue;
                    var i = y * w + x;
                    var before = d[i];
                    d[i] *= MathF.Exp(-c.Rate * f * dt);
                    blown += before - d[i];
                }
            }
            if (effects != null && c.Puffs && blown > 0.4f && r.Next() < dt * 25)
            {
                var a = r.Next() * MathF.PI * 2;
                var rr = c.R * (0.5f + r.Next() * 0.5f);
                effects.Smoke.Emit(new ParticleSpec
                {
                    Position = new Vector3(c.X + MathF.Cos(a) * rr, 0.15f, c.Z + MathF.Sin(a) * rr),
                    Velocity = new Vector3(MathF.Cos(a) * 3, 0.5f + r.Next(), MathF.Sin(a) * 3), Drag = 1.8f,
                    Life = 0.8f, Size0 = 0.3f, Size1 = 1.2f, Aspect = 1, Color0 = new Vector4(1.3f, 1.34f, 1.4f, 0.6f), Color1 = new Vector4(1.25f, 1.3f, 1.35f, 0), HasColor1 = true,
                });
            }
        }
        _uploadTimer -= dt;
        if (_uploadTimer <= 0)
        {
            _uploadTimer = 1 / 15f;
            Upload();
        }
    }

    private void Upload()
    {
        for (var i = 0; i < _depth.Length; i++) _pixels[i] = new Color((int)(_depth[i] * 255), 0, 0, 255);
        // Row 0 of the grid is minZ; the shader samples v = (z - minZ) / depth directly.
        Texture.SetData(_pixels);
    }
}
