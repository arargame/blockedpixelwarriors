using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using BlockedPixelWarriors.World;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>A rolling spiked iron ball.</summary>
public sealed class Mine
{
    public Vector3 Pos, Vel;
    public float Vy, Hp = 5, Respawn;
    public bool Alive = true, Falling, Egg;
    public Vector3 Home;
    public Quaternion Spin = Quaternion.Identity;
}

/// <summary>
/// Rolling spiked iron balls (SpikeMines.js). In play they only come from the SURPRISE EGG card:
/// when the board runs out of blocks a few drop out of the sky, bounce and roll around; shot
/// down they may drop a supply. The poster frame shows three ambient ones.
/// </summary>
public sealed class SpikeMines : IRenderable
{
    private readonly Board _board;
    private readonly BlockField _blocks;
    private readonly Effects _effects;
    private readonly GpuMesh _mesh;
    private readonly InstanceBuffer _instances;
    public List<Mine> Mines { get; } = new();

    public SpikeMines(ModelLibrary models, Board board, BlockField blocks, Effects effects)
    {
        _board = board;
        _blocks = blocks;
        _effects = effects;
        _mesh = models.Mesh("spike_ball");
        _instances = new InstanceBuffer(models.Device, 32, true);
    }

    /// <summary>Three ambient balls at the key-art spots (poster frame).</summary>
    public void AddPosterBalls()
    {
        var rng = new Rng(5);
        foreach (var (x, z) in new[] { (-8.25f, 2.3f), (-1.8f, 3.8f), (-3.6f, 6.4f) })
        {
            var a = rng.Range(0, MathF.PI * 2);
            var p = new Vector3(x, GameConfig.Mines.Radius, z);
            Mines.Add(new Mine { Pos = p, Home = p, Vel = new Vector3(MathF.Cos(a), 0, MathF.Sin(a)) * GameConfig.Mines.Speed });
        }
    }

    private static bool IsTrack(float x) => MathF.Abs(x - GameConfig.Track.X) < 1.6f;

    /// <summary>SURPRISE EGG: drops up to <paramref name="count"/> balls onto free floor spots.</summary>
    public int DropEggs(int count, Func<float, float, bool> isFree)
    {
        var r = GameConfig.Mines.Radius;
        var made = 0;
        var rng = Rng.Shared;
        for (var tries = 0; tries < 200 && made < count; tries++)
        {
            var x = _board.MinX + 2 + rng.Next() * (_board.MaxX - _board.MinX - 4);
            var z = _board.MinZ + 2 + rng.Next() * (_board.MaxZ - _board.MinZ - 4);
            if (IsTrack(x) || _blocks.BlockAt(x, 0.5f, z) != null || !isFree(x, z)) continue;
            if (Mines.Exists(m => m.Alive && MathF.Sqrt((m.Pos.X - x) * (m.Pos.X - x) + (m.Pos.Z - z) * (m.Pos.Z - z)) < 2.5f)) continue;
            var a = rng.Next() * MathF.PI * 2;
            Mines.Add(new Mine
            {
                Pos = new Vector3(x, 14 + made * 2.5f, z),
                Vel = new Vector3(MathF.Cos(a), 0, MathF.Sin(a)) * GameConfig.Mines.Speed,
                Falling = true,
                Egg = true,
                Home = new Vector3(x, r, z),
            });
            made++;
        }
        return made;
    }

    public int EggsAlive
    {
        get
        {
            var n = 0;
            foreach (var m in Mines) if (m.Egg && m.Alive) n++;
            return n;
        }
    }

    public void ClearEggs() => Mines.RemoveAll(m => m.Egg);

    public void Update(float dt)
    {
        var r = GameConfig.Mines.Radius;
        foreach (var m in Mines)
        {
            if (m.Alive && m.Falling)
            {
                m.Vy -= 22 * dt;
                m.Pos.Y += m.Vy * dt;
                m.Spin = Quaternion.CreateFromAxisAngle(Vector3.UnitX, dt * 4) * m.Spin;
                if (m.Pos.Y <= r)
                {
                    m.Pos.Y = r;
                    if (MathF.Abs(m.Vy) > 4)
                    {
                        _effects.SnowPuff(m.Pos, 10);
                        _effects.Shatter(m.Pos, 0xcfc4b0, 6, 0.6f, 0.08f, 0.16f);
                        m.Vy = -m.Vy * 0.38f;
                    }
                    else
                    {
                        m.Vy = 0;
                        m.Falling = false;
                    }
                }
                continue;
            }
            if (!m.Alive)
            {
                if (m.Egg) continue;
                m.Respawn -= dt;
                if (m.Respawn <= 0)
                {
                    m.Alive = true;
                    m.Hp = 5;
                    m.Pos = m.Home;
                    _effects.SnowPuff(m.Pos, 6);
                }
                continue;
            }
            var next = m.Pos + m.Vel * dt;
            if (next.X < _board.MinX + r || next.X > _board.MaxX - r || _blocks.BlockAt(next.X, 0.5f, m.Pos.Z) != null || IsTrack(next.X)) m.Vel.X *= -1;
            if (next.Z < _board.MinZ + r || next.Z > _board.MaxZ - r || _blocks.BlockAt(m.Pos.X, 0.5f, next.Z) != null) m.Vel.Z *= -1;
            m.Pos += m.Vel * dt;
            var speed = m.Vel.Length();
            if (speed > 0)
            {
                // Roll about the axis perpendicular to the velocity (world space).
                var axis = Vector3.Normalize(new Vector3(m.Vel.Z, 0, -m.Vel.X));
                m.Spin = Quaternion.Normalize(Quaternion.CreateFromAxisAngle(axis, speed * dt / r) * m.Spin);
            }
        }
        Mines.RemoveAll(m => m.Egg && !m.Alive);
    }

    public Mine HitTest(Vector3 point)
    {
        var r = GameConfig.Mines.Radius + 0.15f;
        foreach (var m in Mines)
            if (m.Alive && !m.Falling && Vector3.DistanceSquared(m.Pos, point) < r * r) return m;
        return null;
    }

    /// <summary>True when the ball blew up.</summary>
    public bool Damage(Mine m, float amount, Vector3 hitPoint)
    {
        m.Hp -= amount;
        _effects.Impact(hitPoint, new Vector4(3, 3, 3.4f, 1));
        if (m.Hp > 0) return false;
        m.Alive = false;
        m.Respawn = 12;
        _effects.Explosion(m.Pos, 1.0f, 0x55585e, 10);
        return true;
    }

    public void Submit(RenderQueue queue)
    {
        _instances.Count = 0;
        foreach (var m in Mines)
            if (m.Alive) _instances.Add(Matrix.CreateFromQuaternion(m.Spin) * Matrix.CreateTranslation(m.Pos), Vector4.One);
        _instances.Upload();
        queue.Add(_mesh, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _instances);
    }
}
