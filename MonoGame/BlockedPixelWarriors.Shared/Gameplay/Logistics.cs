using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using BlockedPixelWarriors.World;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>Mission bucket of a delivered package (red / green / blue = teal cubes).</summary>
public enum MissionColor { Red, Green, Blue }

/// <summary>A gift package waiting on the dock.</summary>
public sealed class Package
{
    public int C, R;
    public BlockColor Color;
    public Vector3 Pos;
    public float RotY, Scale = 0.01f, Pop;
    public bool Lifting;
}

/// <summary>
/// Dock (leftmost column, two with DOUBLE ROW): one gift package per cell, the first column fills
/// before the second one opens up (Logistics.js Dock).
/// </summary>
public sealed class Dock
{
    public const float Pkg = 1.25f;
    private readonly BlockField _blocks;
    private readonly Dictionary<int, Package> _slots = new();
    private readonly List<Package> _ordered = new();
    public int Columns { get; private set; } = 1;
    public int Count => _slots.Count;
    public int Capacity => _blocks.Rows * Columns;
    public IEnumerable<Package> Packages => _slots.Values;

    public Dock(BlockField blocks) => _blocks = blocks;

    private int Key(int c, int r) => _blocks.Key(c, r);

    public bool HasAt(int c, int r) => _slots.ContainsKey(Key(c, r));

    public bool IsFree(int c, int r) => !HasAt(c, r);

    /// <summary>Free dock cells of the first column that has any.</summary>
    public List<(int c, int r)> FreeSlots(List<(int c, int r)> into)
    {
        into.Clear();
        var c0 = GameConfig.Logistics.DockCol;
        for (var k = 0; k < Columns; k++)
        {
            for (var r = 0; r < _blocks.Rows; r++) if (IsFree(c0 + k, r)) into.Add((c0 + k, r));
            if (into.Count > 0) return into;
        }
        return into;
    }

    public Package Place(int c, int r, BlockColor color, Effects effects)
    {
        var (x, z) = _blocks.CellCenter(c, r);
        var p = new Package { C = c, R = r, Color = color, Pos = new Vector3(x, Pkg / 2, z), RotY = Rng.Shared.Spread(0.06f) };
        _slots[Key(c, r)] = p;
        effects.SparkBurst(p.Pos, 18, 4, new Vector4(4, 3.4f, 1.4f, 1));
        return p;
    }

    /// <summary>Packages in pick-up order: far end first, outer column before inner.</summary>
    public Package First()
    {
        Package best = null;
        foreach (var p in _slots.Values)
            if (best == null || p.R < best.R || (p.R == best.R && p.C < best.C)) best = p;
        return best;
    }

    public void Remove(Package p) => _slots.Remove(Key(p.C, p.R));

    public void Clear() => _slots.Clear();

    public void Widen(Effects effects)
    {
        if (Columns >= 2) return;
        Columns = 2;
        var c = GameConfig.Logistics.DockCol + 1;
        for (var r = 0; r < _blocks.Rows; r++)
        {
            var (x, z) = _blocks.CellCenter(c, r);
            effects.SparkBurst(new Vector3(x, 0.2f, z), 4, 3, new Vector4(4, 3.4f, 1.4f, 1));
        }
    }

    public void Narrow() => Columns = 1;

    public void Update(float dt, Effects effects)
    {
        var rng = Rng.Shared;
        foreach (var p in _slots.Values)
        {
            if (p.Pop < 1)
            {
                // Gift "pops" into place.
                p.Pop = MathF.Min(1, p.Pop + dt * 3);
                p.Scale = p.Pop * (1 + MathF.Sin(p.Pop * MathF.PI) * 0.25f);
            }
            if (!p.Lifting && rng.Next() < dt * 0.25f)
            {
                effects.Fire.Emit(new ParticleSpec
                {
                    Position = new Vector3(p.Pos.X + rng.Spread(0.5f), p.Pos.Y + Pkg * 0.55f, p.Pos.Z + rng.Spread(0.5f)), Velocity = new Vector3(0, 0.6f, 0),
                    Life = 0.6f, Size0 = 0.22f, Size1 = 0.02f, Aspect = 1, Color0 = new Vector4(4, 3.4f, 1.4f, 1), Color1 = new Vector4(2, 1.4f, 0.4f, 0), HasColor1 = true,
                });
            }
        }
    }
}

/// <summary>
/// The engineer on his forklift (Logistics.js Engineer): drives over free yard / dock cells (BFS),
/// picks up the cargo cubes shot off the train and lines them up on the dock as gift packages.
/// </summary>
public sealed class Engineer
{
    private enum JobKind { Pick, Drop }

    private struct Job
    {
        public JobKind Kind;
        public Block Block;
        public int SlotC, SlotR;
        public int FaceX, FaceZ;
    }

    private enum State { Idle, Drive, Align, Work }

    private static readonly (int dc, int dr)[] Dirs = { (1, 0), (-1, 0), (0, 1), (0, -1) };
    private static readonly (int dc, int dr)[] DropDirs = { (1, 0), (0, -1), (0, 1), (-1, 0) };
    private static readonly (int dc, int dr)[] PickDirs = { (-1, 0), (1, 0), (0, -1), (0, 1) };
    private readonly BlockField _blocks;
    private readonly Dictionary<int, Job> _goals = new();
    private readonly Dictionary<int, int> _prev = new();
    private readonly Queue<int> _queue = new();
    private readonly List<(int c, int r)> _slots = new();
    private readonly List<(int c, int r)> _path = new();
    private State _state = State.Idle;
    private Job _job;
    private float _think, _actionT, _time;
    private bool _actionDone;

    public int CellC, CellR;
    public Vector3 Position;
    /// <summary>Root Euler angles (XYZ order): the chopper sets them while it carries the forklift.</summary>
    public Vector3 Rotation;
    public float Yaw;
    public float Lift;
    public bool Active, Visible;
    public BlockColor? Carry;
    /// <summary>Colours the mission still needs (set by Logistics): surplus cargo is left alone.</summary>
    public Func<BlockColor, bool> Wants = _ => true;
    public float Beacon;

    public Engineer(BlockField blocks)
    {
        _blocks = blocks;
        CellC = 2;
        CellR = 6;
        var (x, z) = blocks.CellCenter(2, 6);
        Position = new Vector3(x, 0, z);
    }

    public bool Reserved(int c, int r)
    {
        if (!Active) return false;
        if (CellC == c && CellR == r) return true;
        return _path.Count > 0 && _path[0].c == c && _path[0].r == r;
    }

    public bool Walkable(int c, int r, Dock dock)
    {
        var b = _blocks;
        if (c < 0 || r < 0 || r >= b.Rows || c >= b.Cols) return false;
        if (!b.IsYardCell(c) && !b.IsDockCell(c)) return false;
        if (b.IsDockCell(c) && dock.HasAt(c, r)) return false;
        return b.Cell(c, r) is not { Alive: true };
    }

    /// <summary>Flood fill: every free cell the forklift can drive to from where it is.</summary>
    public HashSet<int> Reachable(Dock dock, HashSet<int> seen)
    {
        var b = _blocks;
        seen.Clear();
        seen.Add(b.Key(CellC, CellR));
        _queue.Clear();
        _queue.Enqueue(b.Key(CellC, CellR));
        while (_queue.Count > 0)
        {
            var k = _queue.Dequeue();
            int c = k / b.Rows, r = k % b.Rows;
            foreach (var (dc, dr) in Dirs)
            {
                int nc = c + dc, nr = r + dr;
                if (!Walkable(nc, nr, dock)) continue;
                var nk = b.Key(nc, nr);
                if (seen.Add(nk)) _queue.Enqueue(nk);
            }
        }
        return seen;
    }

    /// <summary>BFS over free cells to the nearest goal cell.</summary>
    private bool Bfs(Dock dock, out Job goal)
    {
        var b = _blocks;
        var start = b.Key(CellC, CellR);
        _prev.Clear();
        _prev[start] = -1;
        _queue.Clear();
        _queue.Enqueue(start);
        while (_queue.Count > 0)
        {
            var cur = _queue.Dequeue();
            if (_goals.TryGetValue(cur, out goal))
            {
                _path.Clear();
                for (var n = cur; n != start && n >= 0; n = _prev[n]) _path.Insert(0, (n / b.Rows, n % b.Rows));
                return true;
            }
            int c = cur / b.Rows, r = cur % b.Rows;
            foreach (var (dc, dr) in Dirs)
            {
                int nc = c + dc, nr = r + dr;
                if (!Walkable(nc, nr, dock)) continue;
                var nk = b.Key(nc, nr);
                if (_prev.ContainsKey(nk)) continue;
                _prev[nk] = cur;
                _queue.Enqueue(nk);
            }
        }
        goal = default;
        return false;
    }

    /// <summary>Next job: deliver what we carry, or fetch the nearest cargo cube.</summary>
    private void Plan(Dock dock)
    {
        var b = _blocks;
        _goals.Clear();
        if (Carry.HasValue)
        {
            foreach (var (sc, sr) in dock.FreeSlots(_slots))
            {
                foreach (var (dc, dr) in DropDirs)
                {
                    int c = sc + dc, r = sr + dr;
                    var here = CellC == c && CellR == r;
                    if (!here && !Walkable(c, r, dock)) continue;
                    var key = b.Key(c, r);
                    if (!_goals.ContainsKey(key)) _goals[key] = new Job { Kind = JobKind.Drop, SlotC = sc, SlotR = sr, FaceX = -dc, FaceZ = -dr };
                }
            }
        }
        else
        {
            foreach (var l in b.Blocks)
            {
                if (!l.Alive || !l.Cargo || l.Drop > 0 || !Wants(l.Color)) continue;
                foreach (var (dc, dr) in PickDirs)
                {
                    int c = l.C + dc, r = l.R + dr;
                    var here = CellC == c && CellR == r;
                    if (!here && !Walkable(c, r, dock)) continue;
                    var key = b.Key(c, r);
                    if (!_goals.ContainsKey(key)) _goals[key] = new Job { Kind = JobKind.Pick, Block = l, FaceX = -dc, FaceZ = -dr };
                }
            }
        }
        if (_goals.Count == 0 || !Bfs(dock, out var job)) return;
        _job = job;
        _state = State.Drive;
    }

    /// <summary>Puts the forklift into service on a cell (after the chopper set it down).</summary>
    public void Activate(int c, int r)
    {
        var (x, z) = _blocks.CellCenter(c, r);
        CellC = c;
        CellR = r;
        Position = new Vector3(x, 0, z);
        Rotation = new Vector3(0, Yaw, 0);
        _state = State.Idle;
        _path.Clear();
        Carry = null;
        _think = 0.6f;
        Active = true;
    }

    public void Deactivate()
    {
        Active = false;
        Visible = false;
        _state = State.Idle;
        _path.Clear();
        Carry = null;
        Lift = 0;
        Beacon = 0;
    }

    public void Update(float dt, Dock dock, Effects effects, Action<BlockColor> onPlaced)
    {
        if (!Active) return;
        _time += dt;
        var b = _blocks;
        var speed = GameConfig.Logistics.ForkliftSpeed;
        // Beacon blinks while working.
        Beacon = _state == State.Idle ? 0 : MathF.Sin(_time * 9) > 0 ? 3 : 0.4f;

        if (_state == State.Idle)
        {
            _think -= dt;
            if (_think <= 0)
            {
                _think = 0.4f;
                Plan(dock);
            }
        }

        if (_state == State.Drive)
        {
            if (_job.Kind == JobKind.Pick && (!_job.Block.Alive || _job.Block.Drop > 0)) Idle();
            else if (_job.Kind == JobKind.Drop && !dock.IsFree(_job.SlotC, _job.SlotR)) Idle();
            else if (_path.Count == 0) _state = State.Align;
            else
            {
                var (nc, nr) = _path[0];
                if (!Walkable(nc, nr, dock)) Idle(); // something landed in the way: re-plan
                else
                {
                    var (tx, tz) = b.CellCenter(nc, nr);
                    float dx = tx - Position.X, dz = tz - Position.Z;
                    var dist = MathF.Sqrt(dx * dx + dz * dz);
                    if (dist < 0.05f)
                    {
                        Position = new Vector3(tx, 0, tz);
                        CellC = nc;
                        CellR = nr;
                        _path.RemoveAt(0);
                    }
                    else
                    {
                        var diff = MathX.WrapAngle(MathX.YawFor(dx, dz) - Yaw);
                        Yaw += MathF.Sign(diff) * MathF.Min(MathF.Abs(diff), 5 * dt);
                        if (MathF.Abs(diff) < 0.35f)
                        {
                            var step = MathF.Min(dist, speed * dt);
                            Position.X += dx / dist * step;
                            Position.Z += dz / dist * step;
                            // Cell switches half way.
                            if (dist - step < 0.75f)
                            {
                                CellC = nc;
                                CellR = nr;
                            }
                        }
                    }
                }
            }
        }

        if (_state == State.Align)
        {
            var diff = MathX.WrapAngle(MathX.YawFor(_job.FaceX, _job.FaceZ) - Yaw);
            Yaw += MathF.Sign(diff) * MathF.Min(MathF.Abs(diff), 4.5f * dt);
            if (MathF.Abs(diff) < 0.01f)
            {
                _state = State.Work;
                _actionT = 0;
                _actionDone = false;
            }
        }

        if (_state == State.Work)
        {
            _actionT += dt;
            var (hx, hz) = b.CellCenter(CellC, CellR);
            var u = MathF.Min(1, _actionT / 1.8f);
            // Nudge in (forks under the crate), lift / set down, back out.
            var nudge = MathF.Sin(u * MathF.PI) * 0.3f;
            Position = new Vector3(hx + _job.FaceX * nudge, 0, hz + _job.FaceZ * nudge);
            if (_job.Kind == JobKind.Pick)
            {
                if (!_actionDone && u > 0.45f)
                {
                    if (!_job.Block.Alive) _state = State.Idle;
                    else
                    {
                        _actionDone = true;
                        var l = _job.Block;
                        b.TakeBlock(l);
                        Carry = l.Color;
                        effects.SnowPuff(new Vector3(l.X, 0.3f, l.Z), 6);
                    }
                }
                Lift = u > 0.45f ? MathHelper.Lerp(0, 0.35f, MathF.Min(1, (u - 0.45f) * 4)) : 0;
            }
            else
            {
                Lift = u < 0.5f ? MathF.Min(0.2f, Lift + dt * 1.6f) : MathF.Max(0, Lift - dt * 1.4f);
                if (!_actionDone && u > 0.5f)
                {
                    _actionDone = true;
                    if (dock.IsFree(_job.SlotC, _job.SlotR) && Carry.HasValue)
                    {
                        var color = Carry.Value;
                        dock.Place(_job.SlotC, _job.SlotR, color, effects);
                        Carry = null;
                        onPlaced?.Invoke(color);
                    }
                    else
                    {
                        _state = State.Idle;
                    }
                }
            }
            if (u >= 1)
            {
                Position = new Vector3(hx, 0, hz);
                _state = State.Idle;
                _think = 0.15f;
            }
        }
        else
        {
            // Carry height while driving.
            var want = Carry.HasValue ? 0.35f : 0;
            Lift += MathF.Sign(want - Lift) * MathF.Min(MathF.Abs(want - Lift), dt * 1.2f);
        }
        // Little bounce of the cab while driving.
        Rotation = new Vector3(_state == State.Drive ? MathF.Sin(_time * 20) * 0.01f : 0, Yaw, 0);
    }

    private void Idle()
    {
        _state = State.Idle;
        _path.Clear();
    }

    public Matrix World => MathX.RotationXYZ(Rotation.X, Rotation.Y, Rotation.Z) * Matrix.CreateTranslation(Position);
}

/// <summary>CH-47F Chinook: flies the forklift in, then visits every 2 minutes to winch up packages.</summary>
public sealed class Chinook
{
    public enum State { Away, Approach, Turn, Next, Position, Winch, Depart, DApproach, DLower }

    private sealed class Sling
    {
        public Engineer Cargo;
        public Vector3 Spot;
        public Action OnDropped;
        public float T;
    }

    private const float HoverY = 4.3f;
    private Vector3 _vel, _target;
    private float _wantYaw, _waitTimer, _winchT, _pkgStart, _dockX;
    private Package _pkg;
    private Sling _sling;

    public State Phase = State.Away;
    public bool PickupMission;
    public Vector3 Position;
    public float Yaw, Pitch, Roll, Time, RotorAngle;
    public int Loaded;
    public bool Visible;
    /// <summary>Winch cable (belly to hook) while it is in use.</summary>
    public Vector3? CableFrom, CableTo;

    public bool Active => Phase != State.Away;

    public void Reset()
    {
        Phase = State.Away;
        Visible = false;
        _sling = null;
        CableFrom = CableTo = null;
    }

    /// <summary>Starts a visit: enters from the left, heading +X toward the first package's row.</summary>
    public void Arrive(Dock dock, BlockField blocks)
    {
        var first = dock.First();
        var r = first?.R ?? blocks.Rows / 2;
        var z = blocks.CellCenter(0, r).z;
        _dockX = blocks.CellCenter(GameConfig.Logistics.DockCol, 0).x;
        Position = new Vector3(_dockX - 30, 12, z);
        _vel = new Vector3(10, 0, 0);
        Yaw = _wantYaw = MathX.YawFor(1, 0);
        _target = new Vector3(_dockX, HoverY, z);
        Phase = State.Approach;
        PickupMission = true;
        Visible = true;
        Loaded = 0;
        _waitTimer = 0;
    }

    /// <summary>Special run: brings the forklift slung under the belly and lowers it at <paramref name="spot"/>.</summary>
    public void Deliver(Engineer cargo, Vector3 spot, BlockField blocks, Action onDropped)
    {
        _dockX = blocks.CellCenter(GameConfig.Logistics.DockCol, 0).x;
        Position = new Vector3(spot.X - 32, 13, spot.Z);
        _vel = new Vector3(10, 0, 0);
        Yaw = _wantYaw = MathX.YawFor(1, 0);
        _target = new Vector3(spot.X, HoverY + 1.2f, spot.Z);
        Phase = State.DApproach;
        PickupMission = false;
        Visible = true;
        Loaded = 0;
        _sling = new Sling { Cargo = cargo, Spot = spot, OnDropped = onDropped };
    }

    /// <summary>Critically damped move toward the target.</summary>
    private float Steer(float dt, float stiffness = 1.6f)
    {
        var acc = (_target - Position) * (stiffness * stiffness) - _vel * (2 * stiffness);
        _vel += acc * dt;
        Position += _vel * dt;
        return Vector3.Distance(_target, Position);
    }

    public void Update(float dt, Dock dock, Effects effects, Action<BlockColor> onDelivered, Action<int> onLeft)
    {
        if (Phase == State.Away) return;
        Time += dt;
        RotorAngle += dt * 26;
        CableFrom = CableTo = null;
        var belly = Position.Y + 0.15f;

        if (_sling != null && Phase is State.DApproach or State.DLower)
        {
            var s = _sling;
            float hookY;
            if (Phase == State.DApproach)
            {
                var d = Steer(dt, 0.9f);
                hookY = belly - 1.0f;
                if (d < 0.4f && _vel.Length() < 0.8f) Phase = State.DLower;
            }
            else
            {
                Steer(dt, 1.8f);
                belly = Position.Y + 0.15f;
                s.T += dt;
                var u = MathF.Min(1, s.T / 2.4f);
                hookY = MathHelper.Lerp(belly - 1.0f, 2.0f, u * u * (3 - 2 * u));
                if (u >= 1)
                {
                    s.Cargo.Position = new Vector3(s.Spot.X, 0, s.Spot.Z);
                    effects.SnowPuff(new Vector3(s.Spot.X, 0.2f, s.Spot.Z), 14);
                    effects.Shatter(new Vector3(s.Spot.X, 0.25f, s.Spot.Z), 0xcfc4b0, 8, 0.6f, 0.08f, 0.16f);
                    _sling = null;
                    s.OnDropped?.Invoke();
                    Phase = State.Depart;
                    _wantYaw = MathX.YawFor(-1, 0);
                }
            }
            if (_sling != null)
            {
                // Forklift hangs 2 units below the hook, swinging a little.
                s.Cargo.Position = new Vector3(Position.X + MathF.Sin(Time * 1.7f) * 0.06f, hookY - 2.0f, Position.Z);
                s.Cargo.Rotation = new Vector3(0, Yaw + MathF.Sin(Time * 1.1f) * 0.08f, MathF.Sin(Time * 1.7f) * 0.03f);
                CableFrom = new Vector3(Position.X, belly, Position.Z);
                CableTo = new Vector3(s.Cargo.Position.X, hookY, s.Cargo.Position.Z);
            }
        }
        else if (Phase == State.Approach)
        {
            if (Steer(dt, 0.9f) < 0.6f)
            {
                Phase = State.Turn;
                _wantYaw = MathX.YawFor(0, 1); // nose toward the camera, flying down the dock lane
            }
        }
        else if (Phase == State.Turn)
        {
            Steer(dt, 1.4f);
            if (MathF.Abs(MathX.WrapAngle(_wantYaw - Yaw)) < 0.05f) Phase = State.Next;
        }
        else if (Phase == State.Next)
        {
            var next = dock.First();
            if (next == null)
            {
                _waitTimer += dt;
                Steer(dt, 1.4f);
                if (_waitTimer > (Loaded > 0 ? 0.6f : 2.5f))
                {
                    Phase = State.Depart;
                    _wantYaw = MathX.YawFor(-1, 0);
                    _target = new Vector3(_dockX - 40, 15, Position.Z);
                    onLeft?.Invoke(Loaded);
                }
            }
            else
            {
                _waitTimer = 0;
                _pkg = next;
                _target = new Vector3(next.Pos.X, HoverY, next.Pos.Z);
                Phase = State.Position;
            }
        }
        else if (Phase == State.Position)
        {
            if (Steer(dt, 1.8f) < 0.12f && _vel.Length() < 0.6f)
            {
                Phase = State.Winch;
                _pkg.Lifting = true;
                _winchT = 0;
                _pkgStart = _pkg.Pos.Y;
            }
        }
        else if (Phase == State.Winch)
        {
            Steer(dt, 1.8f);
            belly = Position.Y + 0.15f;
            _winchT += dt;
            var u = MathF.Min(1, _winchT / 1.4f);
            var p = _pkg;
            // Hook goes down (0..0.3), then the package rides up into the belly.
            var top = _pkgStart + Dock.Pkg / 2;
            var hookY = u < 0.3f ? MathHelper.Lerp(belly, top, u / 0.3f) : MathHelper.Lerp(top, belly, (u - 0.3f) / 0.7f);
            if (u >= 0.3f)
            {
                p.Pos = new Vector3(Position.X, hookY - Dock.Pkg / 2, Position.Z);
                p.RotY += dt * 1.5f;
                if (u > 0.85f) p.Scale = MathF.Max(0.01f, (1 - u) / 0.15f);
            }
            CableFrom = new Vector3(Position.X, belly, Position.Z);
            CableTo = new Vector3(Position.X, hookY, Position.Z);
            if (u >= 1)
            {
                CableFrom = CableTo = null;
                dock.Remove(p);
                Loaded++;
                effects.SparkBurst(new Vector3(Position.X, belly, Position.Z), 10, 3, new Vector4(4, 3.4f, 1.4f, 1));
                onDelivered?.Invoke(p.Color);
                Phase = State.Next;
            }
        }
        else if (Phase == State.Depart)
        {
            // Accelerate away to the left and up.
            _vel.X -= dt * 7;
            _vel.Y += dt * 1.5f;
            _vel.Z *= MathF.Exp(-dt);
            Position += _vel * dt;
            if (Position.X < _dockX - 38)
            {
                Phase = State.Away;
                Visible = false;
            }
        }
        // Yaw + attitude: pitch into the velocity, bank a little.
        Yaw += MathX.WrapAngle(_wantYaw - Yaw) * (1 - MathF.Exp(-2.2f * dt));
        float fx = -MathF.Sin(Yaw), fz = -MathF.Cos(Yaw);
        var forward = _vel.X * fx + _vel.Z * fz;
        var side = _vel.X * fz - _vel.Z * fx;
        Pitch = MathHelper.Clamp(-forward * 0.025f, -0.3f, 0.3f);
        Roll = MathHelper.Clamp(side * 0.02f, -0.25f, 0.25f) + MathF.Sin(Time * 1.3f) * 0.015f;
        // Rotor wash dust on the floor when low.
        var rng = Rng.Shared;
        if (Position.Y < 7 && rng.Next() < dt * 20)
        {
            var a = rng.Next() * MathF.PI * 2;
            var rr = 2 + rng.Next() * 2.5f;
            effects.Smoke.Emit(new ParticleSpec
            {
                Position = new Vector3(Position.X + MathF.Cos(a) * rr, 0.2f, Position.Z + MathF.Sin(a) * rr), Velocity = new Vector3(MathF.Cos(a) * 4, 0.4f, MathF.Sin(a) * 4), Drag = 1.6f,
                Life = 0.9f, Size0 = 0.4f, Size1 = 1.5f, Aspect = 1, Color0 = new Vector4(1.25f, 1.28f, 1.34f, 0.4f), Color1 = new Vector4(1.2f, 1.25f, 1.3f, 0), HasColor1 = true,
            });
        }
    }

    public Matrix World => MathX.RotationYXZ(Pitch, Yaw, Roll) * Matrix.CreateTranslation(Position);
}

/// <summary>
/// Cargo logistics facade (Logistics.js): the FIELD ENGINEER card brings the forklift in, cubes
/// shot off the train become cargo he stacks on the dock as gift packages, and with the CARGO
/// CHOPPER card the Chinook comes every 2 minutes to winch them up (100 red + green + blue wins).
/// </summary>
public sealed class Logistics : IRenderable
{
    private readonly BlockField _blocks;
    private readonly Effects _effects;
    private readonly HashSet<int> _reach = new();
    private readonly GpuMesh _forkBody, _forkForks, _crate, _giftBox, _giftRibbon, _marking, _chBody, _cable;
    private readonly GpuMesh[] _rotors;
    private readonly Matrix _forksMatrix, _crateMatrix;
    private readonly Matrix[] _rotorMatrices;
    private readonly Vector3 _beaconLocal;
    private readonly PointLight _beacon;
    private readonly RenderMaterial _cableMaterial, _crateMaterial;
    private readonly Vector3 _giftEmissiveBase;
    private bool _hiring;
    private float _intervalMul = 1;

    public Dock Dock { get; }
    public Engineer Engineer { get; }
    public Chinook Chinook { get; } = new();
    public int[] Delivered { get; } = new int[3];
    public float Timer { get; private set; }
    public bool Enabled { get; private set; }
    public bool ChopperEnabled { get; private set; }

    public Action<BlockColor?> OnPackaged;
    public Action<int> OnChinookArrive;
    public Action<BlockColor, MissionColor?> OnDelivered;
    public Action OnEngineerReady;
    public Action<int> OnChinookLeft;

    public static readonly int[] Goal = { GameConfig.Logistics.GoalRed, GameConfig.Logistics.GoalGreen, GameConfig.Logistics.GoalBlue };

    public Logistics(ModelLibrary models, ForkliftData fork, ChinookData chinook, BlockField blocks, Effects effects, LightRig lights)
    {
        _blocks = blocks;
        _effects = effects;
        Dock = new Dock(blocks);
        Engineer = new Engineer(blocks);
        _forkBody = models.Mesh("forklift_body");
        _forkForks = models.Mesh("forklift_forks");
        _crate = models.Mesh("block");
        _crateMaterial = _crate.Material.Clone();
        _giftBox = models.Mesh("gift_box");
        _giftRibbon = models.Mesh("gift_ribbon");
        _giftEmissiveBase = _giftBox.Material.Emissive;
        _marking = models.Mesh("dock_marking");
        _chBody = models.Mesh("chinook_body");
        _rotors = Enumerable.Range(0, chinook?.Rotors?.Count ?? 0).Select(i => models.Mesh($"chinook_rotor{i}")).ToArray();
        _rotorMatrices = chinook?.Rotors?.Select(MathX.FromThree).ToArray() ?? Array.Empty<Matrix>();
        _forksMatrix = fork != null ? MathX.FromThree(fork.ForksMatrix) : Matrix.Identity;
        _crateMatrix = fork != null ? MathX.FromThree(fork.CrateMatrix) : Matrix.Identity;
        _beaconLocal = fork != null ? MathX.V3(fork.Beacon) : new Vector3(0.3f, 2.2f, 0.6f);
        _cable = _crate;
        _cableMaterial = _crate.Material.Clone();
        _cableMaterial.Unlit = true;
        _cableMaterial.Voxel = Vector4.Zero;
        _cableMaterial.Map = null;
        _cableMaterial.BaseColor = new Vector4(Palette.ToLinear(0x1a1a1a), 1);
        _beacon = new PointLight { Color = Palette.ToLinear(0xff8a1c), Intensity = 0, Distance = 3, Decay = 2 };
        lights.Points.Add(_beacon);
        blocks.IsReserved = Engineer.Reserved;
        blocks.ReachableCells = () => Engineer.Active ? Engineer.Reachable(Dock, _reach) : null;
        // Train cargo only becomes protected, collectable cargo once the engineer is on duty.
        blocks.CargoEnabled = () => Enabled;
        // The engineer knows the mission: a colour stops being cargo once delivered + docked +
        // on the forks reaches its goal (no time lost on surplus packages).
        blocks.CargoWanted = Wants;
        Engineer.Wants = Wants;
        Reset();
    }

    /// <summary>Seconds between chopper visits (RUSH DELIVERY: 30% shorter).</summary>
    public float Interval => GameConfig.Logistics.ChinookInterval * _intervalMul;

    /// <summary>The pick-up schedule runs once there is an engineer AND the cargo chopper contract.</summary>
    public bool CountdownActive => Enabled && ChopperEnabled;

    public bool MissionComplete => Delivered[0] >= Goal[0] && Delivered[1] >= Goal[1] && Delivered[2] >= Goal[2];

    public static MissionColor? MissionKey(BlockColor c) => c switch
    {
        BlockColor.Red => MissionColor.Red,
        BlockColor.Green => MissionColor.Green,
        BlockColor.Teal => MissionColor.Blue,
        _ => null,
    };

    /// <summary>Packages of a colour still needed: delivered + waiting on the dock + on the forks &lt; goal.</summary>
    public bool Wants(BlockColor color)
    {
        if (MissionKey(color) is not { } key) return false;
        var n = Delivered[(int)key];
        foreach (var p in Dock.Packages)
            if (MissionKey(p.Color) == key) n++;
        if (Engineer.Carry is { } carry && MissionKey(carry) == key) n++;
        return n < Goal[(int)key];
    }

    /// <summary>Cargo of colours no longer needed turns into ordinary blocks (shootable, unguarded).</summary>
    private void ReleaseSurplus()
    {
        var changed = false;
        foreach (var l in _blocks.Blocks)
        {
            if (!l.Alive || !l.Cargo || Wants(l.Color)) continue;
            l.Cargo = false;
            changed = true;
        }
        if (changed) _blocks.MarkDirty();
    }

    /// <summary>Back to the start of a run: no engineer yet (he comes with the FIELD ENGINEER card).</summary>
    public void Reset()
    {
        Array.Clear(Delivered);
        _intervalMul = 1;
        Timer = Interval;
        Enabled = false;
        _hiring = false;
        ChopperEnabled = false;
        Dock.Narrow();
        _blocks.DockColumns = 1;
        Engineer.Deactivate();
        Dock.Clear();
        Chinook.Reset();
    }

    /// <summary>FIELD ENGINEER card: the chopper flies the forklift in and lowers it near the middle of the yard.</summary>
    public void HireEngineer()
    {
        if (Enabled || _hiring) return;
        _hiring = true;
        var b = _blocks;
        (int c, int r) best = (2, 6);
        var bestD = float.MaxValue;
        for (var c = 1; c < b.Cols; c++)
        {
            if (!b.IsYardCell(c)) continue;
            for (var r = 1; r < b.Rows - 1; r++)
            {
                if (b.Cell(c, r) is { Alive: true }) continue;
                float d = (c - 3) * (c - 3) + (r - 6) * (r - 6);
                if (d < bestD)
                {
                    bestD = d;
                    best = (c, r);
                }
            }
        }
        var (x, z) = b.CellCenter(best.c, best.r);
        var e = Engineer;
        e.Visible = true;
        e.Yaw = MathX.YawFor(1, 0);
        Chinook.Deliver(e, new Vector3(x, 0, z), b, () =>
        {
            e.Activate(best.c, best.r);
            Enabled = true;
            _hiring = false;
            Timer = Interval;
            OnEngineerReady?.Invoke();
        });
    }

    /// <summary>RUSH DELIVERY card: the chopper comes sooner, the running countdown shrinks with it.</summary>
    public void SpeedUpChopper(float mul)
    {
        _intervalMul = mul;
        Timer *= mul;
    }

    /// <summary>CARGO CHOPPER card: from now on the Chinook comes for the packages.</summary>
    public void EnableChopper()
    {
        if (ChopperEnabled) return;
        ChopperEnabled = true;
        Timer = Interval;
    }

    /// <summary>DOUBLE ROW card: a second dock column; blocks standing there are cleared (cargo is packed).</summary>
    public void WidenDock()
    {
        if (Dock.Columns >= 2) return;
        var b = _blocks;
        var c = GameConfig.Logistics.DockCol + 1;
        for (var r = 0; r < b.Rows; r++)
        {
            var l = b.Cell(c, r);
            if (l is not { Alive: true }) continue;
            b.TakeBlock(l);
            if (l.Cargo) Dock.Place(c, r, l.Color, _effects);
            else
            {
                _effects.Shatter(new Vector3(l.X, 0.7f, l.Z), Train.PackedColor(l.Color), 10, 0.8f, 0.12f, 0.3f);
                _effects.SnowPuff(new Vector3(l.X, 0.3f, l.Z), 6);
            }
        }
        b.DockColumns = 2;
        Dock.Widen(_effects);
        OnPackaged?.Invoke(null);
    }

    public void Update(float dt, bool clockRunning)
    {
        Engineer.Update(dt, Dock, _effects, c => OnPackaged?.Invoke(c));
        if (Enabled) ReleaseSurplus();
        Dock.Update(dt, _effects);
        if (CountdownActive && !Chinook.Active && clockRunning)
        {
            Timer -= dt;
            if (Timer <= 0)
            {
                Chinook.Arrive(Dock, _blocks);
                OnChinookArrive?.Invoke(Dock.Count);
            }
        }
        Chinook.Update(dt, Dock, _effects, color =>
        {
            var key = MissionKey(color);
            if (key.HasValue) Delivered[(int)key.Value]++;
            OnDelivered?.Invoke(color, key);
        }, loaded =>
        {
            Timer = Interval;
            OnChinookLeft?.Invoke(loaded);
        });
        _beacon.Intensity = Engineer.Visible ? Engineer.Beacon : 0;
        if (Engineer.Visible) _beacon.Position = Vector3.Transform(_beaconLocal, Engineer.World);
    }

    /// <summary>Rotor wash / wheels push settled floor snow away.</summary>
    public void SnowClearers(List<FloorSnow.Clearer> into)
    {
        if (Engineer.Active) into.Add(new FloorSnow.Clearer(Engineer.Position.X, Engineer.Position.Z, 0.9f, 4, false));
        if (Chinook.Active && Chinook.Position.Y < 8)
            into.Add(new FloorSnow.Clearer(Chinook.Position.X, Chinook.Position.Z, 4.5f, 2.2f * (1 - Chinook.Position.Y / 8) + 0.6f, true));
    }

    public void Submit(RenderQueue queue)
    {
        // Dock lanes.
        for (var k = 0; k < Dock.Columns; k++)
            queue.Add(_marking, Matrix.CreateTranslation(k * _blocks.Size, 0, 0), DrawOverrides.None, false, 1);
        // Gift packages.
        foreach (var p in Dock.Packages)
        {
            var w = Matrix.CreateScale(p.Scale) * Matrix.CreateRotationY(p.RotY) * Matrix.CreateTranslation(p.Pos);
            var color = new Vector4(Palette.ToLinear(Palette.Block(p.Color)), 1);
            var over = new DrawOverrides { ColorMul = Vector4.One, BaseColor = color, EmissiveAdd = new Vector3(color.X, color.Y, color.Z) * 0.08f - _giftEmissiveBase };
            queue.Add(_giftBox, w, over);
            queue.Add(_giftRibbon, w, DrawOverrides.None);
        }
        // Engineer + forklift.
        var e = Engineer;
        if (e.Visible)
        {
            var root = e.World;
            queue.Add(_forkBody, root, DrawOverrides.None);
            var forks = _forksMatrix * Matrix.CreateTranslation(0, e.Lift, 0) * root;
            queue.Add(_forkForks, forks, DrawOverrides.None);
            if (e.Carry.HasValue)
                queue.Add(_crate, _crateMatrix * forks, new DrawOverrides { ColorMul = Vector4.One, BaseColor = new Vector4(TrainFactory.BlockLinear(e.Carry.Value), 1) }, true, 0, RenderLayer.World, null, _crateMaterial);
        }
        // Chinook.
        var ch = Chinook;
        if (ch.Visible)
        {
            var w = ch.World;
            queue.Add(_chBody, w, DrawOverrides.None);
            for (var i = 0; i < _rotors.Length; i++)
                queue.Add(_rotors[i], Matrix.CreateRotationY((i == 0 ? 1 : -1) * ch.RotorAngle) * _rotorMatrices[i] * w, DrawOverrides.None);
            if (ch.CableFrom is { } a && ch.CableTo is { } b && Vector3.Distance(a, b) > 0.01f)
            {
                var len = a.Y - b.Y;
                var mid = (a + b) * 0.5f;
                var dir = Vector3.Normalize(a - b);
                var tilt = Matrix.Identity;
                var axis = Vector3.Cross(Vector3.UnitY, dir);
                if (axis.LengthSquared() > 1e-8f) tilt = Matrix.CreateFromAxisAngle(Vector3.Normalize(axis), MathF.Acos(MathHelper.Clamp(dir.Y, -1, 1)));
                queue.Add(_cable, Matrix.CreateScale(0.025f, Vector3.Distance(a, b), 0.025f) * tilt * Matrix.CreateTranslation(mid), DrawOverrides.None, false, 0, RenderLayer.World, null, _cableMaterial);
            }
        }
    }
}
