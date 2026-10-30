using System.Text.Json;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>What a checkpoint keeps: the stage-2 start with score, wave and taken upgrade cards.</summary>
public sealed class CheckpointSave
{
    public int Stage { get; set; } = 2;
    public int Score { get; set; }
    public int Wave { get; set; }
    public List<string> Cards { get; set; } = new();
}

/// <summary>Persists the checkpoint (localStorage on the web; a small JSON file here).</summary>
public interface ICheckpointStore
{
    CheckpointSave Load();
    void Save(CheckpointSave save);
    void Clear();
}

/// <summary>JSON file in the app's local data folder (desktop: %LOCALAPPDATA%, Android: app files).</summary>
public sealed class FileCheckpointStore : ICheckpointStore
{
    private readonly string _path;

    public FileCheckpointStore(string path = null)
    {
        _path = path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BlockedPixelWarriors", GameConfig.Stages.SaveFile);
    }

    public CheckpointSave Load()
    {
        try
        {
            return File.Exists(_path) ? JsonSerializer.Deserialize<CheckpointSave>(File.ReadAllText(_path)) : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    public void Save(CheckpointSave save)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            File.WriteAllText(_path, JsonSerializer.Serialize(save));
        }
        catch (Exception)
        {
            // No storage: the run just can't be continued later.
        }
    }

    public void Clear()
    {
        try
        {
            if (File.Exists(_path)) File.Delete(_path);
        }
        catch (Exception)
        {
            // ignore
        }
    }
}

/// <summary>
/// Checkpoint gate over the bridge at the terrace entrance (Checkpoint.js): a glowing hoop on two
/// posts. Flying through (or past) it saves the run and turns it green, then it fades away.
/// </summary>
public sealed class CheckpointGate : IRenderable
{
    private readonly Effects _effects;
    private readonly GpuMesh _gate, _chevrons;
    private readonly PointLight _light;
    private float _time, _fade = 1, _spin;

    public Vector3 Position { get; } = new(GameConfig.Stages.CheckpointX, GameConfig.Heli.Altitude, GameConfig.Stages.CheckpointZ);
    public bool Visible { get; private set; }
    public bool Reached { get; private set; }

    public CheckpointGate(ModelLibrary models, Effects effects, LightRig lights)
    {
        _effects = effects;
        _gate = models.Mesh("checkpoint_gate");
        _chevrons = models.Mesh("checkpoint_chevrons");
        _light = new PointLight { Color = Palette.ToLinear(0xffc040), Intensity = 0, Distance = 7, Decay = 2 };
        lights.Points.Add(_light);
    }

    public void Show(bool on)
    {
        Visible = on;
        Reached = false;
        _fade = 1;
        if (!on) _light.Intensity = 0;
    }

    /// <summary>True the moment the heli passes the gate line.</summary>
    public bool Update(float dt, Vector3 heli)
    {
        if (!Visible) return false;
        _time += dt;
        _spin += dt * 1.4f;
        _light.Position = Position;
        _light.Intensity = Reached ? 0 : 6 + MathF.Sin(_time * 5) * 2;
        if (Reached)
        {
            _fade = MathF.Max(0, _fade - dt * 0.8f);
            if (_fade <= 0) Visible = false;
            return false;
        }
        if (heli.Z < Position.Z + 1.0f)
        {
            Reached = true;
            _effects.SparkBurst(Position, 50, 8, new Vector4(1.2f, 4, 1.2f, 1));
            _effects.FlashLight(Position, 0x60ff60, 40, 0.4f, 10);
            return true;
        }
        return false;
    }

    public void Submit(RenderQueue queue)
    {
        if (!Visible || _gate == null) return;
        var world = Matrix.CreateScale(1 + (1 - _fade) * 0.4f) * Matrix.CreateTranslation(Position);
        var green = new Vector4(Palette.ToLinear(0x7be86a), 1);
        foreach (var part in _gate.Parts)
        {
            var m = part.Material;
            var glowing = m.Emissive.LengthSquared() > 0.01f;
            var over = Reached && glowing
                ? new DrawOverrides { ColorMul = Vector4.One, BaseColor = green, EmissiveAdd = Palette.ToLinear(0x40d040) * 2.2f - m.Emissive }
                : DrawOverrides.None;
            queue.AddPart(_gate, part, world, over);
        }
        if (_chevrons != null)
            queue.Add(_chevrons, Matrix.CreateRotationZ(_spin) * world, new DrawOverrides { ColorMul = new Vector4(1, 1, 1, _fade) }, false);
    }
}

/// <summary>In-memory store (automated captures must not touch the player's save).</summary>
public sealed class MemoryCheckpointStore : ICheckpointStore
{
    private CheckpointSave _save;

    public MemoryCheckpointStore(CheckpointSave initial = null) => _save = initial;

    public CheckpointSave Load() => _save;

    public void Save(CheckpointSave save) => _save = save;

    public void Clear() => _save = null;
}
