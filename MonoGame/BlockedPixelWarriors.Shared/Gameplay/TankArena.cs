using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Gameplay;

public enum TankBlockType { Weak, Normal, Strong, Supply }

/// <summary>A block sliding down a lane of the tank channel (BlockFlow.js).</summary>
public sealed class TankBlock
{
    public int Lane;
    public float X, Z;
    public BlockColor Color;
    public TankBlockType Type;
    public float Hp, MaxHp, Flash, ChainAt, Rot;
    public int ChainDepth;
    public bool Alive = true;
}

/// <summary>
/// Blocks sliding down the channel lanes (src/tank/BlockFlow.js, grid + push, Blocked Pixel Panzer
/// style): every block sits in a lane and slides toward the dam at one constant speed; a block
/// never overlaps the one in front of it (a landing block shoves the ones below it, a block held
/// up by the tank holds up the line); the tank is pushed by the blocks touching it; destroyed
/// blocks blow up their same-coloured neighbours one after another. Types: weak (1 hit, lighter),
/// normal, strong (steel cage), supply (star, drops a power-up). Blocks past the lip go to OnDrain.
/// </summary>
public sealed class BlockFlow
{
    private const int Max = 520;
    private readonly Effects _effects;
    private readonly GpuMesh _block, _cage, _star;
    private readonly RenderMaterial _blockMaterial;
    private readonly InstanceBuffer _blocks, _cages, _stars;
    private readonly List<(TankBlock b, Vector3 from, float t, float dur, float spin)> _airborne = new();
    private readonly List<TankBlock> _chain = new();
    public readonly List<TankBlock>[] Lanes;
    public float Size => GameConfig.TankArena.Block;
    public Action<TankBlock> OnDrain;
    public Action<TankBlock, int, Vector3> OnDestroyed;
    /// <summary>Residual push the tank could not take (the block is held back by it).</summary>
    public Func<TankBlock, float> ResolveTank;

    public BlockFlow(ModelLibrary models, Effects effects)
    {
        _effects = effects;
        Lanes = Enumerable.Range(0, GameConfig.TankArena.Lanes).Select(_ => new List<TankBlock>()).ToArray();
        _block = models.Mesh("block");
        _blockMaterial = _block.Material.Clone();
        _blockMaterial.BaseColor = Vector4.One; // colour per instance
        _cage = models.Mesh("block_armor");
        _star = models.Mesh("block_supply");
        _blocks = new InstanceBuffer(models.Device, Max, true);
        _cages = new InstanceBuffer(models.Device, Max, true);
        _stars = new InstanceBuffer(models.Device, Max, true);
    }

    public void Reset()
    {
        foreach (var l in Lanes) l.Clear();
        _airborne.Clear();
        _chain.Clear();
    }

    public static float LaneX(int i) => (i - (GameConfig.TankArena.Lanes - 1) / 2f) * GameConfig.TankArena.Block;

    public static int LaneAt(float x)
    {
        var i = (int)MathF.Floor(x / GameConfig.TankArena.Block + (GameConfig.TankArena.Lanes - 1) / 2f + 0.5f); // Math.round
        return i >= 0 && i < GameConfig.TankArena.Lanes ? i : -1;
    }

    public int Count
    {
        get
        {
            var n = _airborne.Count;
            foreach (var l in Lanes) n += l.Count;
            return n;
        }
    }

    private static TankBlockType RollType()
    {
        var r = Rng.Shared.Next();
        if (r < GameConfig.TankArena.OddsSupply) return TankBlockType.Supply;
        if (r < GameConfig.TankArena.OddsSupply + GameConfig.TankArena.OddsStrong) return TankBlockType.Strong;
        if (r < GameConfig.TankArena.OddsSupply + GameConfig.TankArena.OddsStrong + GameConfig.TankArena.OddsWeak) return TankBlockType.Weak;
        return TankBlockType.Normal;
    }

    private static float HpOf(TankBlockType t) => t switch
    {
        TankBlockType.Weak => GameConfig.TankArena.HpWeak,
        TankBlockType.Strong => GameConfig.TankArena.HpStrong,
        TankBlockType.Supply => GameConfig.TankArena.HpSupply,
        _ => GameConfig.TankArena.HpNormal,
    };

    /// <summary>A block thrown from a train wagon at `from`, landing on `lane` at z.</summary>
    public void Drop(int lane, float z, Vector3 from)
    {
        var r = Rng.Shared;
        var color = Palette.BlockColors[(int)(r.Next() * 4)];
        var type = RollType();
        var hp = HpOf(type);
        var b = new TankBlock { Lane = lane, X = LaneX(lane), Z = z, Color = color, Type = type, Hp = hp, MaxHp = hp, Rot = (int)(r.Next() * 4) * MathHelper.PiOver2 };
        _airborne.Add((b, from, 0, 0.7f + r.Next() * 0.15f, r.Spread(6)));
    }

    /// <summary>Puts a landed block on its lane and shoves the blocks it lands on down the lane.</summary>
    private void Land(TankBlock b)
    {
        var lane = Lanes[b.Lane];
        lane.Add(b);
        lane.Sort((a, c) => a.Z.CompareTo(c.Z));
        var s = Size;
        for (var i = lane.Count - 2; i >= 0; i--)
            if (lane[i].Z > lane[i + 1].Z - s) lane[i].Z = lane[i + 1].Z - s;
        _effects.SnowPuff(new Vector3(b.X, GameConfig.TankArena.FloorHeight(b.Z) + 0.3f, b.Z), 6);
    }

    public TankBlock BlockAt(float x, float z)
    {
        var lane = LaneAt(x);
        if (lane < 0) return null;
        var h = Size / 2;
        foreach (var b in Lanes[lane])
            if (b.Alive && MathF.Abs(b.Z - z) <= h) return b;
        return null;
    }

    public bool Damage(TankBlock b, float amount, Vector3 hitPoint)
    {
        if (!b.Alive) return false;
        b.Hp -= amount;
        b.Flash = 0.08f;
        if (b.Hp <= 0)
        {
            Destroy(b, 0);
            return true;
        }
        _effects.Shatter(hitPoint, b.Type == TankBlockType.Strong ? 0x8a9099 : Hex(b.Color), 4, 0.6f, 0.12f, 0.26f);
        if (b.Type == TankBlockType.Strong) _effects.SparkBurst(hitPoint, 5, 6, new Vector4(4, 3.6f, 3, 1));
        return false;
    }

    public static uint Hex(BlockColor c)
    {
        var k = Palette.Block(c);
        return (uint)(k.R << 16 | k.G << 8 | k.B);
    }

    private void Destroy(TankBlock b, int depth)
    {
        if (!b.Alive) return;
        b.Alive = false;
        b.ChainAt = 0;
        var at = new Vector3(b.X, GameConfig.TankArena.FloorHeight(b.Z) + Size / 2, b.Z);
        _effects.Explosion(at, depth > 0 ? 0.75f : 0.9f, null, 0);
        _effects.Shatter(at, Hex(b.Color), depth > 0 ? 10 : 16, 1.1f, 0.2f, 0.5f);
        if (b.Type == TankBlockType.Strong) _effects.Shatter(at, 0x6f757e, 8, 1.2f, 0.15f, 0.3f);
        Lanes[b.Lane].Remove(b);
        OnDestroyed?.Invoke(b, depth, at);
        // Same-coloured neighbours: back to back in the lane, or side by side in the next lane.
        var s = Size;
        for (var dl = -1; dl <= 1; dl++)
        {
            var li = b.Lane + dl;
            if (li < 0 || li >= Lanes.Length) continue;
            foreach (var n in Lanes[li])
            {
                if (!n.Alive || n.Color != b.Color || n.ChainAt > 0) continue;
                var dz = MathF.Abs(n.Z - b.Z);
                if ((dl == 0 && dz <= s * 1.08f) || (dl != 0 && dz <= s * 0.6f))
                {
                    n.ChainAt = GameConfig.TankArena.ChainDelay;
                    n.ChainDepth = depth + 1;
                    _chain.Add(n);
                }
            }
        }
    }

    public void Update(float dt)
    {
        var s = Size;
        // Chain reaction.
        for (var i = _chain.Count - 1; i >= 0; i--)
        {
            var n = _chain[i];
            n.ChainAt -= dt;
            if (n.ChainAt <= 0)
            {
                _chain.RemoveAt(i);
                if (n.Alive) Destroy(n, n.ChainDepth);
            }
        }
        // Airborne blocks land on their lane.
        for (var i = _airborne.Count - 1; i >= 0; i--)
        {
            var a = _airborne[i];
            a.t += dt;
            if (a.t >= a.dur)
            {
                _airborne.RemoveAt(i);
                Land(a.b);
            }
            else _airborne[i] = a;
        }
        // Slide: front block first; each keeps a block's length behind the one in front of it.
        var step = GameConfig.TankArena.SlideSpeed * dt;
        foreach (var lane in Lanes)
        {
            for (var i = 0; i < lane.Count; i++)
            {
                var b = lane[i];
                var z = b.Z - step;
                if (i > 0) z = MathF.Max(z, lane[i - 1].Z + s);
                b.Z = z;
                // The tank takes the push; if it cannot move any further the block is held up.
                var held = ResolveTank?.Invoke(b) ?? 0;
                if (held > 0) b.Z += held;
                b.Flash = MathF.Max(0, b.Flash - dt);
            }
            // Over the dam lip: into the drain.
            while (lane.Count > 0 && lane[0].Z < -s * 0.15f)
            {
                var b = lane[0];
                lane.RemoveAt(0);
                OnDrain?.Invoke(b);
            }
        }
    }

    /// <summary>Instance matrices for every block (lanes + airborne arcs).</summary>
    private void WriteInstances()
    {
        var S = Size * 0.95f;
        _blocks.Count = _cages.Count = _stars.Count = 0;
        void Put(TankBlock b, float x, float y, float z, float rx, float ry, float scale)
        {
            var m = Matrix.CreateScale(S * scale) * MathX.RotationXYZ(rx, ry, 0) * Matrix.CreateTranslation(x, y, z);
            var k = (b.Type == TankBlockType.Weak ? 1.35f : 1) * (1 + b.Flash * 12);
            _blocks.Add(m, new Vector4(TrainFactory.BlockLinear(b.Color) * k, 1));
            if (b.Type == TankBlockType.Strong) _cages.Add(m, Vector4.One);
            if (b.Type == TankBlockType.Supply) _stars.Add(m, Vector4.One);
        }
        foreach (var lane in Lanes)
        foreach (var b in lane)
        {
            var sc = b.Type == TankBlockType.Weak ? 0.9f : 1;
            Put(b, b.X, GameConfig.TankArena.FloorHeight(b.Z) + S * sc / 2, b.Z, 0, b.Rot, sc);
        }
        foreach (var a in _airborne)
        {
            var t = MathF.Min(1, a.t / a.dur);
            var e = t * t;
            var b = a.b;
            var sc = b.Type == TankBlockType.Weak ? 0.9f : 1;
            var x = MathHelper.Lerp(a.from.X, b.X, t);
            var z = MathHelper.Lerp(a.from.Z, b.Z, t);
            var y = MathHelper.Lerp(a.from.Y, GameConfig.TankArena.FloorHeight(b.Z) + S * sc / 2, e) + MathF.Sin(t * MathF.PI) * 1.4f;
            Put(b, x, y, z, a.spin * (1 - t), b.Rot + a.spin * (1 - t), sc);
        }
        _blocks.Upload();
        _cages.Upload();
        _stars.Upload();
    }

    public void Submit(RenderQueue queue)
    {
        WriteInstances();
        queue.Add(_block, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _blocks, _blockMaterial);
        queue.Add(_cage, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _cages);
        queue.Add(_star, Matrix.Identity, DrawOverrides.None, false, 0, RenderLayer.World, _stars);
    }
}

/// <summary>
/// The drain basin's pile (src/tank/DrainPile.js): every block that gets past the dam lip tumbles
/// in and stays. A small position-based physics solver (no library): each block is a sphere of
/// the block's half size for contacts plus a spinning orientation for the cube it draws; gravity,
/// the basin floor and its oval wall (below the rim), block-block contacts pushed apart in equal
/// shares a few iterations per substep, Verlet velocity, extra drag and a splash in the water,
/// friction and spin damping in contact so the pile settles into a heap.
/// </summary>
public sealed class DrainPile
{
    private const int Max = 140;
    private const float Gravity = 24;

    private sealed class Body
    {
        public Vector3 P, Prev, W;
        public Quaternion Q;
        public BlockColor Color;
        public bool Wet, Contact;
    }

    private readonly Effects _effects;
    private readonly List<Body> _bodies = new();
    private readonly GpuMesh _block;
    private readonly RenderMaterial _material;
    private readonly InstanceBuffer _instances;
    private readonly float _r = GameConfig.TankArena.Block * 0.5f;

    public DrainPile(ModelLibrary models, Effects effects)
    {
        _effects = effects;
        _block = models.Mesh("block");
        _material = _block.Material.Clone();
        _material.BaseColor = Vector4.One;
        _instances = new InstanceBuffer(models.Device, Max, true);
    }

    public int Count => _bodies.Count;

    public void Reset() => _bodies.Clear();

    /// <summary>A block falls over the lip at (x, y, z) moving down the channel.</summary>
    public void Add(float x, float y, float z, BlockColor color)
    {
        if (_bodies.Count >= Max) return;
        var r = Rng.Shared;
        var p = new Vector3(x, y, z);
        var v = new Vector3(r.Spread(0.6f), 0.5f, -GameConfig.TankArena.SlideSpeed * 1.6f - r.Next() * 1.2f);
        _bodies.Add(new Body
        {
            P = p, Prev = p - v / 60f, Color = color,
            Q = Quaternion.CreateFromAxisAngle(Vector3.Up, (int)(r.Next() * 4) * MathHelper.PiOver2),
            W = new Vector3(-2.5f - r.Next() * 2, r.Spread(2), r.Spread(1.5f)),
        });
    }

    /// <summary>DRAIN PUMP power-up: the top `n` blocks are flushed away.</summary>
    public void Remove(int n)
    {
        _bodies.Sort((a, b) => a.P.Y.CompareTo(b.P.Y));
        for (var i = 0; i < n && _bodies.Count > 0; i++)
        {
            var b = _bodies[^1];
            _bodies.RemoveAt(_bodies.Count - 1);
            _effects.SnowPuff(b.P, 8);
        }
    }

    public void Update(float dt)
    {
        const float depth = GameConfig.TankArena.DrainDepth;
        var r = _r;
        var floorY = -depth + r;
        var surface = -depth + GameConfig.TankArena.DrainWater;
        var ex = GameConfig.TankArena.DrainRx - r;
        var ez = GameConfig.TankArena.DrainRz - r;
        const int sub = 2;
        var h = MathF.Min(dt, 1 / 30f) / sub;
        var B = _bodies;
        for (var s = 0; s < sub; s++)
        {
            foreach (var b in B)
            {
                // Verlet step with gravity.
                var d = b.P - b.Prev;
                b.Prev = b.P;
                b.P += d * (b.Wet ? 0.96f : 0.995f);
                b.P.Y -= Gravity * h * h;
                b.Contact = false;
            }
            for (var it = 0; it < 3; it++)
            {
                for (var i = 0; i < B.Count; i++)
                {
                    var a = B[i];
                    for (var j = i + 1; j < B.Count; j++)
                    {
                        var c = B[j];
                        var d = c.P - a.P;
                        var l2 = d.LengthSquared();
                        if (l2 >= 4 * r * r || l2 < 1e-8f) continue;
                        var l = MathF.Sqrt(l2);
                        d *= (2 * r - l) * 0.5f / l;
                        a.P -= d;
                        c.P += d;
                        a.Contact = c.Contact = true;
                    }
                }
                foreach (var b in B)
                {
                    if (b.P.Y < floorY)
                    {
                        b.P.Y = floorY;
                        b.Contact = true;
                    }
                    // The oval wall only holds what is below the rim.
                    if (b.P.Y < 0.2f)
                    {
                        var x = b.P.X;
                        var z = b.P.Z - GameConfig.TankArena.DrainZ;
                        var k = x / ex * (x / ex) + z / ez * (z / ez);
                        if (k > 1)
                        {
                            var f = 1 / MathF.Sqrt(k);
                            b.P.X = x * f;
                            b.P.Z = GameConfig.TankArena.DrainZ + z * f;
                            b.Contact = true;
                        }
                    }
                }
            }
            foreach (var b in B)
            {
                if (b.Contact)
                {
                    // Friction: the horizontal motion since the last step is mostly lost.
                    b.Prev.X = MathHelper.Lerp(b.Prev.X, b.P.X, 0.25f);
                    b.Prev.Z = MathHelper.Lerp(b.Prev.Z, b.P.Z, 0.25f);
                }
                var wet = b.P.Y < surface;
                if (wet && !b.Wet) Splash(b);
                b.Wet = wet;
            }
        }
        // Spin: tumbling while falling, damped hard once resting on something.
        foreach (var b in B)
        {
            b.W *= MathF.Exp(-(b.Contact ? 6 : 0.6f) * dt);
            var ang = b.W.Length() * dt;
            if (ang > 1e-5f) b.Q = Quaternion.Normalize(Quaternion.Concatenate(b.Q, Quaternion.CreateFromAxisAngle(Vector3.Normalize(b.W), ang)));
        }
    }

    private void Splash(Body b)
    {
        var y = -GameConfig.TankArena.DrainDepth + GameConfig.TankArena.DrainWater + 0.1f;
        var r = Rng.Shared;
        for (var i = 0; i < 10; i++)
        {
            _effects.Smoke.Emit(new ParticleSpec
            {
                Position = new Vector3(b.P.X + r.Spread(0.6f), y, b.P.Z + r.Spread(0.6f)), Velocity = new Vector3(r.Spread(2.5f), r.Range(2, 5), r.Spread(2.5f)),
                Drag = 1.6f, Gravity = 9, Life = r.Range(0.5f, 0.9f), Size0 = 0.35f, Size1 = r.Range(0.9f, 1.4f), Aspect = 1,
                Color0 = new Vector4(1.2f, 1.35f, 1.45f, 0.9f), Color1 = new Vector4(1.1f, 1.2f, 1.3f, 0), HasColor1 = true,
            });
        }
    }

    public void Submit(RenderQueue queue)
    {
        var S = GameConfig.TankArena.Block * 0.95f;
        _instances.Count = 0;
        foreach (var b in _bodies)
            _instances.Add(Matrix.CreateScale(S) * Matrix.CreateFromQuaternion(b.Q) * Matrix.CreateTranslation(b.P), new Vector4(TrainFactory.BlockLinear(b.Color), 1));
        _instances.Upload();
        queue.Add(_block, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _instances, _material);
    }
}

/// <summary>
/// A goods train crossing the rail at the far end of the channel (src/tank/ArenaTrain.js):
/// locomotive + cargo flatcars from the train factory, 1.6x scale. As each wagon passes over a
/// lane it may drop a block into it (the level decides: a gap, one block or two back to back).
/// </summary>
public sealed class ArenaTrain
{
    private const float Scale = 1.6f;
    private readonly Effects _effects;
    private readonly TrainFactory _factory;
    private readonly List<TrainCar> _cars = new();
    private readonly int[] _lastLane;
    private readonly int _dir;
    private readonly float _endX, _railY;
    private float _x, _smokeTimer;
    private readonly InstanceBuffer _cubes, _snowCaps;
    public bool Done { get; private set; }
    /// <summary>(lane, from): a wagon over a lane drops a block.</summary>
    public Action<int, Vector3> OnDrop;

    public ArenaTrain(TrainFactory factory, Effects effects, GraphicsDevice device, float railY, int dir, int wagons, uint seed)
    {
        _factory = factory;
        _effects = effects;
        _dir = dir;
        _railY = railY;
        _cars.Add(factory.Build(CarKind.Locomotive, 0));
        for (var i = 0; i < wagons; i++) _cars.Add(factory.Build(CarKind.Cargo, seed * 17 + (uint)i, 0.5f));
        float offset = 0;
        foreach (var car in _cars)
        {
            car.OffsetZ = -offset - car.Length / 2;
            offset += car.Length + 0.35f;
        }
        var length = offset * Scale;
        _lastLane = Enumerable.Repeat(-2, _cars.Count).ToArray();
        var half = GameConfig.TankArena.Width / 2 + 40;
        _x = -dir * half;
        _endX = dir * (half + length);
        var cubes = Math.Max(1, _cars.Sum(c => c.Targets.Count(t => t.Kind == TargetKind.Cargo)));
        _cubes = new InstanceBuffer(device, cubes, true);
        _snowCaps = new InstanceBuffer(device, cubes, true);
        UpdateTransforms();
    }

    private void UpdateTransforms()
    {
        var group = Matrix.CreateScale(Scale) * Matrix.CreateRotationY(_dir > 0 ? MathHelper.PiOver2 : -MathHelper.PiOver2)
            * Matrix.CreateTranslation(_x, _railY + 0.18f, GameConfig.TankArena.RailZ);
        foreach (var car in _cars)
        {
            car.World = Matrix.CreateTranslation(0, 0, car.OffsetZ) * group;
            foreach (var t in car.Turrets)
            {
                t.BaseWorld = Matrix.CreateTranslation(t.Mount) * car.World;
                t.HeadWorld = t.BaseWorld;
            }
        }
    }

    public void Update(float dt)
    {
        _x += _dir * GameConfig.TankArena.TrainSpeed * dt;
        UpdateTransforms();
        // Wagons over a new lane: drop (or not).
        for (var i = 1; i < _cars.Count; i++)
        {
            var w = _cars[i].World.Translation;
            var lane = BlockFlow.LaneAt(w.X);
            if (lane == _lastLane[i]) continue;
            _lastLane[i] = lane;
            if (lane >= 0) OnDrop?.Invoke(lane, w + new Vector3(0, 2.4f, 0));
        }
        _smokeTimer -= dt;
        if (_smokeTimer <= 0)
        {
            _smokeTimer = 0.09f;
            var loco = _cars[0];
            foreach (var c in loco.Chimneys) _effects.ChimneySmoke(loco.ToWorld(c), 0.8f);
        }
        if (_dir * (_x - _endX) > 0) Done = true;
    }

    public void Submit(RenderQueue queue)
    {
        _cubes.Count = 0;
        _snowCaps.Count = 0;
        foreach (var car in _cars)
        {
            queue.Add(car.Body, car.World);
            foreach (var t in car.Turrets)
            {
                queue.Add(_factory.TurretBase, t.BaseWorld);
                queue.Add(_factory.TurretHead, t.HeadWorld);
            }
            foreach (var t in car.Targets)
            {
                if (t.Kind != TargetKind.Cargo) continue;
                var m = Matrix.CreateScale(t.Size) * Matrix.CreateRotationY(t.CubeYaw) * Matrix.CreateTranslation(t.Center) * car.World;
                _cubes.Add(m, new Vector4(TrainFactory.BlockLinear(t.Color), 1));
                if (t.Snow) _snowCaps.Add(m, Vector4.One);
            }
        }
        _cubes.Upload();
        _snowCaps.Upload();
        queue.Add(_factory.CargoCube, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _cubes, _factory.CubeMaterial);
        queue.Add(_factory.CargoSnow, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _snowCaps);
    }
}
