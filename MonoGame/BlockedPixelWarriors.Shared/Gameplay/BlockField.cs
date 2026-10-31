using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

public enum BlockType { Normal, Armored, Supply }

/// <summary>One grid cell's block (alive or not; records are reused).</summary>
public sealed class Block
{
    public int C, R;
    public float X, Z;
    public BlockColor Color;
    public BlockType Type;
    public float Hp, MaxHp, Flash, Drop, ChainAt;
    public int ChainDepth;
    public bool Alive, Cargo;
    public int Snow = -1;
    public float RotY, Jitter;
    public Vector3 FallFrom;
    public float FallT, FallDur;
    public bool Falling;
    public bool Acid;
    public float AcidTimer;
}

/// <summary>
/// Grid of destructible voxel blocks (BlockField.js). Lookup by cell is O(1) (array grid), a
/// destroyed block chain-explodes same-coloured neighbours, cubes knocked off the train fall onto
/// the nearest free cell. Rendering is instanced: one draw per mesh kind for the whole board.
/// </summary>
public sealed class BlockField : IRenderable
{
    private readonly Effects _effects;
    private readonly Block[] _grid;
    private readonly List<Block> _chain = new();
    private readonly Rng _rng = new(2026);
    private readonly GpuMesh _block, _armor, _supply, _cargo, _acid;
    private readonly GpuMesh[] _snow;
    private readonly RenderMaterial _blockMaterial;
    private readonly InstanceBuffer _blocks, _armors, _supplies, _cargos, _acids;
    private readonly InstanceBuffer[] _snows;
    private float _acidTime, _sparkleTimer;
    private bool _dirty = true;

    public float Size => GameConfig.BlockSize;
    public float OriginX => GameConfig.Board.MinX;
    public float OriginZ => GameConfig.Board.MinZ;
    public int Cols { get; }
    public int Rows { get; }
    public List<Block> Blocks { get; } = new();
    public Action<Block, int> OnBlockDestroyed;
    public int DockColumns = 1;
    /// <summary>Whether red / green / blue train cubes land as protected cargo (engineer on duty).</summary>
    public Func<bool> CargoEnabled = () => false;
    /// <summary>Colour still needed by the mission (surplus lands as ordinary blocks).</summary>
    public Func<BlockColor, bool> CargoWanted = _ => true;

    /// <summary>Re-upload block instances after flags changed outside the field.</summary>
    public void MarkDirty() => _dirty = true;
    /// <summary>Cells the forklift occupies or is about to (no block may fall there).</summary>
    public Func<int, int, bool> IsReserved = (_, _) => false;
    /// <summary>Cell keys (c * Rows + r) the forklift can drive to, or null.</summary>
    public Func<HashSet<int>> ReachableCells = () => null;

    public int Key(int c, int r) => c * Rows + r;

    public BlockField(ModelLibrary models, Effects effects)
    {
        _effects = effects;
        Cols = (int)MathF.Floor((GameConfig.Board.MaxX - OriginX) / Size);
        Rows = (int)MathF.Floor((GameConfig.Board.MaxZ - OriginZ) / Size);
        _grid = new Block[Cols * Rows];
        var device = models.Device;
        _block = models.Mesh("block");
        _blockMaterial = _block.Material.Clone();
        _blockMaterial.BaseColor = Vector4.One; // colour per instance
        _armor = models.Mesh("block_armor");
        _supply = models.Mesh("block_supply");
        _cargo = models.Mesh("block_cargo");
        _acid = models.Mesh("block_acid");
        _snow = Enumerable.Range(0, 3).Select(i => models.Mesh($"block_snowcap{i}")).ToArray();
        var cap = Cols * Rows;
        _blocks = new InstanceBuffer(device, cap, true);
        _armors = new InstanceBuffer(device, cap, true);
        _supplies = new InstanceBuffer(device, cap, true);
        _cargos = new InstanceBuffer(device, cap, true);
        _acids = new InstanceBuffer(device, cap, true);
        _snows = _snow.Select(_ => new InstanceBuffer(device, cap, true)).ToArray();
        CreateLayout();
    }

    public (float x, float z) CellCenter(int c, int r) => (OriginX + (c + 0.5f) * Size, OriginZ + (r + 0.5f) * Size);

    public Block Cell(int c, int r) => c < 0 || r < 0 || c >= Cols || r >= Rows ? null : _grid[c * Rows + r];

    public bool IsTrackCell(int c) => MathF.Abs(CellCenter(c, 0).x - GameConfig.Track.X) < 1.6f;

    public bool IsDockCell(int c) => c >= 0 && c < DockColumns;

    public bool IsYardCell(int c) => !IsDockCell(c) && !IsTrackCell(c) && CellCenter(c, 0).x < GameConfig.Track.X;

    public static bool IsGoalColor(BlockColor c) => c is BlockColor.Red or BlockColor.Green or BlockColor.Teal;

    private BlockType RollType()
    {
        var r = Rng.Shared.Next();
        if (r < GameConfig.Blocks.SupplyChance) return BlockType.Supply;
        if (r < GameConfig.Blocks.SupplyChance + GameConfig.Blocks.ArmoredChance) return BlockType.Armored;
        return BlockType.Normal;
    }

    /// <summary>Creates (or revives) the block in a cell.</summary>
    public Block PlaceBlock(int c, int r, BlockColor color, BlockType? type = null, int snow = -1, Vector3? from = null, bool cargo = false)
    {
        var b = _grid[c * Rows + r];
        if (b == null)
        {
            var (x, z) = CellCenter(c, r);
            b = new Block { C = c, R = r, X = x, Z = z };
            _grid[c * Rows + r] = b;
            Blocks.Add(b);
        }
        var t = type ?? RollType();
        var hp = t == BlockType.Armored ? GameConfig.Blocks.ArmoredHp : GameConfig.Blocks.Hp;
        b.Color = color;
        b.Type = t;
        b.Hp = b.MaxHp = hp;
        b.Alive = true;
        b.Flash = 0;
        b.Drop = 0;
        b.ChainAt = 0;
        b.Cargo = cargo;
        b.Acid = false;
        b.Snow = snow;
        b.RotY = _rng.Int(0, 3) * MathHelper.PiOver2;
        b.Jitter = _rng.Spread(0.03f);
        b.Falling = from.HasValue;
        if (from.HasValue)
        {
            b.FallFrom = from.Value;
            b.FallT = 0;
            b.FallDur = 0.75f;
            b.Drop = 1;
        }
        _dirty = true;
        return b;
    }

    /// <summary>Hand-authored opening layout matching the key art (row 0 = far wall, col 0 = left wall).</summary>
    private void CreateLayout()
    {
        string[] map =
        {
            "..........GY", ".....Y....TR", "......G...YG", "..........RT", "R.........GY", "GG........TR", "TY........YG",
            "R.........RT", "Y......G..GY", "TT....YY..YR", ".....GGY..TG", "......RR..RY", ".....RR...GT",
        };
        for (var r = 0; r < map.Length; r++)
        {
            for (var c = 0; c < map[r].Length; c++)
            {
                BlockColor? color = map[r][c] switch { 'R' => BlockColor.Red, 'G' => BlockColor.Green, 'T' => BlockColor.Teal, 'Y' => BlockColor.Yellow, _ => null };
                if (color == null || c >= Cols || r >= Rows || IsTrackCell(c) || IsDockCell(c)) continue;
                PlaceBlock(c, r, color.Value, snow: _rng.Chance(0.72f) ? _rng.Int(0, 2) : -1);
            }
        }
    }

    /// <summary>Clears and rebuilds the opening layout (new run).</summary>
    public void Reset()
    {
        foreach (var b in Blocks) b.Alive = false;
        _chain.Clear();
        CreateLayout();
    }

    /// <summary>
    /// A cube knocked off the train falls onto the nearest free yard cell (left of the track).
    /// Returns false when nothing is free nearby (the caller shatters it instead).
    /// </summary>
    public bool DropFromTrain(Vector3 from, BlockColor color)
    {
        var cargo = IsGoalColor(color) && CargoEnabled() && CargoWanted(color);
        // Cargo lands where the forklift can get at it (closest such cell), else the closest free one.
        var reach = cargo ? ReachableCells() : null;
        int bc = -1, br = -1;
        var bestD = float.MaxValue;
        for (var c = 0; c < Cols; c++)
        {
            if (!IsYardCell(c)) continue;
            for (var r = 0; r < Rows; r++)
            {
                var b = Cell(c, r);
                if (b is { Alive: true } || IsReserved(c, r)) continue;
                var (x, z) = CellCenter(c, r);
                var d = (x - from.X) * (x - from.X) + (z - from.Z) * (z - from.Z);
                if (reach != null && !reach.Contains(Key(c, r))) d += 1000;
                if (d < bestD) { bestD = d; bc = c; br = r; }
            }
        }
        var md = GameConfig.Blocks.MaxDropDistance * GameConfig.Blocks.MaxDropDistance;
        if (bc < 0 || (bestD >= 1000 ? bestD - 1000 : bestD) > md) return false;
        PlaceBlock(bc, br, color, cargo ? BlockType.Normal : null, from: from, cargo: cargo);
        return true;
    }

    /// <summary>The engineer lifts a cargo block off the board (no explosion, no score).</summary>
    public bool TakeBlock(Block b)
    {
        if (!b.Alive) return false;
        b.Alive = false;
        b.ChainAt = 0;
        _dirty = true;
        return true;
    }

    /// <summary>Green gem acid: the block turns green, glows lime and melts away.</summary>
    public void ApplyAcid(Block b)
    {
        if (!b.Alive || b.Cargo || b.Acid || b.Drop > 0) return;
        b.Acid = true;
        b.AcidTimer = GameConfig.Blocks.AcidTick;
        b.Color = BlockColor.Green;
        b.Snow = -1;
        _effects.SparkBurst(new Vector3(b.X, Size, b.Z), 10, 3, new Vector4(0.8f, 4, 0.6f, 1));
        _dirty = true;
    }

    /// <summary>The live, landed block occupying a world point, or null (O(1) grid lookup).</summary>
    public Block BlockAt(float x, float y, float z)
    {
        if (y > Size || y < -0.2f) return null;
        var c = (int)MathF.Floor((x - OriginX) / Size);
        var r = (int)MathF.Floor((z - OriginZ) / Size);
        var b = Cell(c, r);
        return b is { Alive: true } && b.Drop <= 0 ? b : null;
    }

    /// <summary>Applies damage; true when the block was destroyed.</summary>
    public bool Damage(Block b, float amount, Vector3 hitPoint)
    {
        if (!b.Alive) return false;
        var hadSnow = b.Hp >= b.MaxHp && b.Snow >= 0;
        b.Hp -= amount;
        b.Flash = 0.08f;
        if (hadSnow) _effects.SnowPuff(new Vector3(b.X, Size + 0.1f, b.Z), 7);
        _dirty = true;
        if (b.Hp <= 0)
        {
            DestroyBlock(b, 0);
            return true;
        }
        var color = b.Type == BlockType.Armored ? 0x8a9099u : Train.PackedColor(b.Color);
        _effects.Shatter(hitPoint, color, 3, 0.6f, 0.12f, 0.26f);
        if (b.Type == BlockType.Armored) _effects.SparkBurst(hitPoint, 4, 6, new Vector4(4, 3.6f, 3, 1));
        return false;
    }

    /// <summary>Destroys a block and queues its same-coloured neighbours (chain reaction).</summary>
    public void DestroyBlock(Block b, int depth)
    {
        if (!b.Alive) return;
        b.Alive = false;
        b.ChainAt = 0;
        _dirty = true;
        var center = new Vector3(b.X, Size * 0.5f, b.Z);
        _effects.Explosion(center, depth > 0 ? 0.65f : 0.8f);
        _effects.Shatter(center, Train.PackedColor(b.Color), depth > 0 ? 10 : 16, 1, 0.2f, 0.5f);
        if (b.Type == BlockType.Armored) _effects.Shatter(center, 0x6f757e, 8, 1.2f, 0.15f, 0.3f);
        OnBlockDestroyed?.Invoke(b, depth);
        ReadOnlySpan<(int dc, int dr)> dirs = stackalloc (int, int)[] { (1, 0), (-1, 0), (0, 1), (0, -1) };
        foreach (var (dc, dr) in dirs)
        {
            var n = Cell(b.C + dc, b.R + dr);
            if (n is { Alive: true } && n.Drop <= 0 && !n.Cargo && !b.Cargo && n.Color == b.Color && n.ChainAt == 0)
            {
                n.ChainAt = GameConfig.Blocks.ChainDelay;
                n.ChainDepth = depth + 1;
                _chain.Add(n);
            }
        }
    }

    public void Update(float dt)
    {
        var rng = Rng.Shared;
        for (var i = _chain.Count - 1; i >= 0; i--)
        {
            var n = _chain[i];
            n.ChainAt -= dt;
            if (n.ChainAt > 0) continue;
            _chain.RemoveAt(i);
            if (n.Alive) DestroyBlock(n, n.ChainDepth);
        }
        _acidTime += dt;
        foreach (var b in Blocks)
        {
            if (!b.Alive || !b.Acid) continue;
            b.AcidTimer -= dt;
            if (rng.Next() < dt * 9)
            {
                var top = Size * (0.45f + 0.55f * MathF.Max(0, b.Hp / b.MaxHp));
                _effects.Fire.Emit(new ParticleSpec
                {
                    Position = new Vector3(b.X + rng.Spread(0.65f), top + 0.05f, b.Z + rng.Spread(0.65f)), Velocity = new Vector3(0, rng.Range(0.3f, 0.9f), 0),
                    Life = rng.Range(0.4f, 0.7f), Size0 = rng.Range(0.15f, 0.3f), Size1 = 0.03f, Aspect = 1,
                    Color0 = new Vector4(0.7f, 3.2f, 0.5f, 1), Color1 = new Vector4(0.2f, 1.2f, 0.1f, 0), HasColor1 = true,
                });
            }
            if (b.AcidTimer <= 0)
            {
                b.AcidTimer += GameConfig.Blocks.AcidTick;
                Damage(b, GameConfig.Blocks.AcidDamageMin + rng.Next() * (GameConfig.Blocks.AcidDamageMax - GameConfig.Blocks.AcidDamageMin), new Vector3(b.X, Size * 0.6f, b.Z));
            }
        }
        _sparkleTimer -= dt;
        var sparkle = _sparkleTimer <= 0;
        if (sparkle) _sparkleTimer = 0.25f;
        foreach (var b in Blocks)
        {
            if (!b.Alive) continue;
            if (b.Flash > 0)
            {
                b.Flash -= dt;
                _dirty = true;
            }
            if (b.Falling)
            {
                b.FallT += dt;
                if (b.FallT >= b.FallDur)
                {
                    b.Falling = false;
                    b.Drop = 0;
                    _effects.SnowPuff(new Vector3(b.X, 0.2f, b.Z), 6);
                    _effects.Shatter(new Vector3(b.X, 0.3f, b.Z), 0xcfc4b0, 5, 0.5f, 0.08f, 0.16f);
                }
                _dirty = true;
            }
            if (sparkle && b.Type == BlockType.Supply && !b.Falling && rng.Chance(0.5f))
            {
                _effects.Fire.Emit(new ParticleSpec
                {
                    Position = new Vector3(b.X + rng.Spread(0.7f), Size + 0.05f, b.Z + rng.Spread(0.7f)), Velocity = new Vector3(0, rng.Range(0.4f, 1), 0),
                    Life = 0.6f, Size0 = 0.25f, Size1 = 0.02f, Aspect = 1, Color0 = new Vector4(4, 3.4f, 1.4f, 1), Color1 = new Vector4(2, 1.4f, 0.4f, 0), HasColor1 = true,
                });
            }
        }
        // Acid film pulses every frame.
        if (Blocks.Exists(b => b.Alive && b.Acid)) _dirty = true;
    }

    /// <summary>Rebuilds the instance lists (only when something changed).</summary>
    private void WriteInstances()
    {
        _blocks.Count = _armors.Count = _supplies.Count = _cargos.Count = _acids.Count = 0;
        foreach (var s in _snows) s.Count = 0;
        var s0 = Size * 0.985f;
        foreach (var b in Blocks)
        {
            if (!b.Alive) continue;
            float px = b.X, py = s0 * 0.5f, pz = b.Z, spin = 0;
            if (b.Falling)
            {
                var t = MathF.Min(1, b.FallT / b.FallDur);
                var e = t * t * (3 - 2 * t);
                px = MathHelper.Lerp(b.FallFrom.X, b.X, e);
                pz = MathHelper.Lerp(b.FallFrom.Z, b.Z, e);
                py = MathHelper.Lerp(b.FallFrom.Y, s0 * 0.5f, t * t) + MathF.Sin(t * MathF.PI) * 1.6f;
                spin = (1 - t) * 4;
            }
            var sy = s0;
            if (b.Acid)
            {
                sy = s0 * (0.45f + 0.55f * MathF.Max(0, b.Hp / b.MaxHp));
                py = sy * 0.5f;
            }
            var m = Matrix.CreateScale(s0, sy, s0) * MathX.RotationXYZ(spin * 0.6f, b.RotY + b.Jitter + spin, 0) * Matrix.CreateTranslation(px, py, pz);
            var tint = b.Flash > 0 ? 2.4f : 1f;
            _blocks.Add(m, new Vector4(TrainFactory.BlockLinear(b.Color) * tint, 1));
            if (b.Type == BlockType.Armored) _armors.Add(m, Vector4.One);
            if (b.Type == BlockType.Supply) _supplies.Add(m, Vector4.One);
            if (b.Cargo) _cargos.Add(m, Vector4.One);
            if (b.Acid) _acids.Add(m, new Vector4(1, 1, 1, 1));
            if (b.Snow >= 0 && b.Hp >= b.MaxHp && !b.Falling)
            {
                var cap = Matrix.CreateScale(s0, sy, s0) * Matrix.CreateRotationY(b.RotY + b.Jitter) * Matrix.CreateTranslation(b.X, s0, b.Z);
                _snows[b.Snow].Add(cap, Vector4.One);
            }
        }
        _blocks.Upload();
        _armors.Upload();
        _supplies.Upload();
        _cargos.Upload();
        _acids.Upload();
        foreach (var s in _snows) s.Upload();
    }

    public void Submit(RenderQueue queue)
    {
        if (_dirty)
        {
            WriteInstances();
            _dirty = false;
        }
        queue.Add(_block, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _blocks, _blockMaterial);
        queue.Add(_armor, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _armors);
        queue.Add(_supply, Matrix.Identity, DrawOverrides.None, false, 0, RenderLayer.World, _supplies);
        queue.Add(_cargo, Matrix.Identity, DrawOverrides.None, false, 0, RenderLayer.World, _cargos);
        var acidOpacity = (0.28f + MathF.Sin(_acidTime * 7) * 0.1f) / MathF.Max(0.01f, _acid?.Material?.BaseColor.W ?? 1);
        queue.Add(_acid, Matrix.Identity, new DrawOverrides { ColorMul = new Vector4(1, 1, 1, acidOpacity) }, false, 0, RenderLayer.World, _acids);
        for (var i = 0; i < _snow.Length; i++) queue.Add(_snow[i], Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _snows[i]);
    }
}
