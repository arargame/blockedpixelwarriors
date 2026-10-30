using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Fx;

/// <summary>Spawn description of one particle (ParticleSystem.emit options). Unset fields use defaults.</summary>
public struct ParticleSpec
{
    public Vector3 Position, Velocity;
    public float Life;
    public float Size0, Size1, Aspect;
    public Vector4 Color0, Color1;
    public float? Rotation;
    public float RotVel, Gravity, Drag, Stretch;
    /// <summary>When false, Color1 = Color0 with alpha 0 (the web default).</summary>
    public bool HasColor1;

    public static ParticleSpec At(Vector3 p) => new() { Position = p, Life = 1, Size0 = 1, Size1 = 1, Aspect = 1, Color0 = Vector4.One };
}

/// <summary>
/// CPU-simulated particle pool drawn through one <see cref="BillboardBatch"/> (one draw call).
/// Records live in a flat struct array and die by swap-remove: no allocations after start-up.
/// </summary>
public sealed class ParticleSystem : IRenderable
{
    private struct Particle
    {
        public Vector3 Pos, Vel;
        public float Life, MaxLife, Size0, Size1, Aspect;
        public Vector4 C0, C1;
        public float Rot, RotVel, Gravity, Drag, Stretch;
    }

    private readonly Particle[] _items;
    private int _count;
    public BillboardBatch Batch { get; }
    public int Count => _count;

    public ParticleSystem(BillboardBatch batch)
    {
        Batch = batch;
        _items = new Particle[batch.Capacity];
    }

    public void Emit(in ParticleSpec p)
    {
        if (_count >= _items.Length) return;
        ref var d = ref _items[_count++];
        d.Pos = p.Position;
        d.Vel = p.Velocity;
        d.Life = 0;
        d.MaxLife = p.Life <= 0 ? 1 : p.Life;
        d.Size0 = p.Size0;
        d.Size1 = p.Size1;
        d.Aspect = p.Aspect <= 0 ? 1 : p.Aspect;
        d.C0 = p.Color0;
        d.C1 = p.HasColor1 ? p.Color1 : new Vector4(p.Color0.X, p.Color0.Y, p.Color0.Z, 0);
        d.Rot = p.Rotation ?? Core.Rng.Shared.Next() * MathF.PI * 2;
        d.RotVel = p.RotVel;
        d.Gravity = p.Gravity;
        d.Drag = p.Drag;
        d.Stretch = p.Stretch;
    }

    public void Update(float dt)
    {
        var b = Batch;
        b.Begin();
        var i = 0;
        while (i < _count)
        {
            ref var d = ref _items[i];
            d.Life += dt;
            if (d.Life >= d.MaxLife)
            {
                _items[i] = _items[--_count];
                continue;
            }
            var drag = MathF.Max(0, 1 - d.Drag * dt);
            d.Vel.X *= drag;
            d.Vel.Y = d.Vel.Y * drag - d.Gravity * dt;
            d.Vel.Z *= drag;
            d.Pos += d.Vel * dt;
            d.Rot += d.RotVel * dt;
            var t = d.Life / d.MaxLife;
            var size = d.Size0 + (d.Size1 - d.Size0) * t;
            var c = Vector4.Lerp(d.C0, d.C1, t);
            if (d.Stretch > 0)
            {
                var speed = d.Vel.Length();
                b.Push(d.Pos.X, d.Pos.Y, d.Pos.Z, size, size * d.Aspect + speed * d.Stretch, c.X, c.Y, c.Z, c.W, 0, d.Vel.X, d.Vel.Y, d.Vel.Z);
            }
            else
            {
                b.Push(d.Pos.X, d.Pos.Y, d.Pos.Z, size, size * d.Aspect, c.X, c.Y, c.Z, c.W, d.Rot);
            }
            i++;
        }
        b.End();
    }

    public void Clear()
    {
        _count = 0;
        Batch.Begin();
        Batch.End();
    }

    public void Submit(RenderQueue queue) => queue.Add(Batch);
}
