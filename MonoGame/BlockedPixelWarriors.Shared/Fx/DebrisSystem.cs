using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Fx;

/// <summary>
/// Flying voxel chunks from destroyed blocks and cargo (DebrisSystem.js): one instanced mesh,
/// simple tumbling motion with ground bounce and settling. Fixed-size ring of structs.
/// </summary>
public sealed class DebrisSystem : IRenderable
{
    private struct Chunk
    {
        public Vector3 Pos, Vel, Rot, Spin;
        public float Size, Life, MaxLife;
        public Vector4 Color;
        public bool Resting;
    }

    private readonly Chunk[] _items;
    private int _count;
    private readonly GpuMesh _mesh;
    private readonly RenderMaterial _material;
    private readonly InstanceBuffer _instances;
    private readonly Func<float, float, float?> _groundHeightAt;

    public DebrisSystem(GpuMesh cube, RenderMaterial material, InstanceBuffer instances, Func<float, float, float?> groundHeightAt)
    {
        _mesh = cube;
        _material = material;
        _instances = instances;
        _items = new Chunk[instances.Capacity];
        _groundHeightAt = groundHeightAt;
    }

    public void Spawn(Vector3 position, Vector3 velocity, float size, Vector3 color, float life, float spin = 10)
    {
        var rng = Rng.Shared;
        if (_count >= _items.Length)
        {
            // Oldest out (items.shift()).
            Array.Copy(_items, 1, _items, 0, _count - 1);
            _count--;
        }
        _items[_count++] = new Chunk
        {
            Pos = position,
            Vel = velocity,
            Rot = new Vector3(rng.Next() * 6, rng.Next() * 6, rng.Next() * 6),
            Spin = new Vector3((rng.Next() - 0.5f) * spin, (rng.Next() - 0.5f) * spin, (rng.Next() - 0.5f) * spin),
            Size = size,
            Life = 0,
            MaxLife = life * (0.75f + rng.Next() * 0.5f),
            Color = new Vector4(color, 1),
        };
    }

    public void Update(float dt)
    {
        var write = 0;
        _instances.Count = 0;
        for (var i = 0; i < _count; i++)
        {
            var d = _items[i];
            d.Life += dt;
            if (d.Life >= d.MaxLife || d.Pos.Y < -60) continue;
            if (!d.Resting)
            {
                d.Vel.Y -= 22 * dt;
                d.Pos += d.Vel * dt;
                d.Rot += d.Spin * dt;
                var ground = _groundHeightAt(d.Pos.X, d.Pos.Z);
                if (ground.HasValue && d.Pos.Y - d.Size * 0.5f < ground.Value && d.Vel.Y < 0)
                {
                    d.Pos.Y = ground.Value + d.Size * 0.5f;
                    d.Vel.Y *= -0.35f;
                    d.Vel.X *= 0.6f;
                    d.Vel.Z *= 0.6f;
                    d.Spin *= 0.5f;
                    if (MathF.Abs(d.Vel.Y) < 1.2f)
                    {
                        d.Resting = true;
                        d.Rot.X = MathF.Round(d.Rot.X / MathHelper.PiOver2) * MathHelper.PiOver2;
                        d.Rot.Z = MathF.Round(d.Rot.Z / MathHelper.PiOver2) * MathHelper.PiOver2;
                    }
                }
            }
            var fade = 1 - MathF.Max(0, (d.Life - d.MaxLife + 0.5f) / 0.5f);
            var s = d.Size * MathF.Max(0.001f, fade);
            var m = Matrix.CreateScale(s) * MathX.RotationXYZ(d.Rot.X, d.Rot.Y, d.Rot.Z) * Matrix.CreateTranslation(d.Pos);
            _instances.Add(m, d.Color);
            _items[write++] = d;
        }
        _count = write;
        _instances.Upload();
    }

    public void Clear() => _count = 0;

    public void Submit(RenderQueue queue) => queue.Add(_mesh, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _instances, _material);
}
