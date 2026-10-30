using System.Text.Json;

namespace BlockedPixelWarriors.Core;

/// <summary>
/// Player settings from the main menu OPTIONS (Settings.js). Volumes are 0..10 steps (no audio
/// yet; kept for when it comes). <see cref="Quality"/> null = automatic; it applies on the next start.
/// </summary>
public sealed class GameSettings
{
    public string Lang { get; set; } = "en";
    public int Master { get; set; } = 8;
    public int Music { get; set; } = 7;
    public int Sfx { get; set; } = 8;
    public string Quality { get; set; }
    public bool Shake { get; set; } = true;
    public bool Fullscreen { get; set; }

    public static readonly string[] Languages = { "en", "tr" };
    public static readonly string[] QualityCycle = { null, "high", "medium", "low" };

    public int Get(string key) => key switch { "master" => Master, "music" => Music, "sfx" => Sfx, _ => 0 };

    public void Set(string key, int value)
    {
        switch (key)
        {
            case "master": Master = value; break;
            case "music": Music = value; break;
            case "sfx": Sfx = value; break;
        }
    }

    public GameSettings Normalized()
    {
        if (Array.IndexOf(Languages, Lang) < 0) Lang = "en";
        if (Quality != null && Array.IndexOf(QualityCycle, Quality) < 0) Quality = null;
        Master = Math.Clamp(Master, 0, 10);
        Music = Math.Clamp(Music, 0, 10);
        Sfx = Math.Clamp(Sfx, 0, 10);
        return this;
    }
}

/// <summary>Furthest stage reached in a scenario (1 depot, 2 terrace, 3 boss) and whether it was beaten.</summary>
public sealed class ScenarioProgress
{
    public int Best { get; set; } = 1;
    public bool Cleared { get; set; }
}

/// <summary>Settings + scenario progress storage (localStorage on the web).</summary>
public interface ISettingsStore
{
    GameSettings Settings { get; }
    void Save();
    ScenarioProgress Progress(string id = "rail");
    void Reach(int stage, string id = "rail");
    void Clear(string id = "rail");
}

/// <summary>In memory (automated captures).</summary>
public class MemorySettingsStore : ISettingsStore
{
    protected Dictionary<string, ScenarioProgress> Scenarios = new();

    public GameSettings Settings { get; protected set; } = new();

    public virtual void Save()
    {
    }

    public ScenarioProgress Progress(string id = "rail") => Scenarios.TryGetValue(id, out var p) ? p : new ScenarioProgress();

    public void Reach(int stage, string id = "rail")
    {
        var p = Scenarios.TryGetValue(id, out var x) ? x : Scenarios[id] = new ScenarioProgress();
        p.Best = Math.Max(p.Best, stage);
        SaveProgress();
    }

    public void Clear(string id = "rail")
    {
        var p = Scenarios.TryGetValue(id, out var x) ? x : Scenarios[id] = new ScenarioProgress();
        p.Cleared = true;
        p.Best = Math.Max(p.Best, 2);
        SaveProgress();
    }

    protected virtual void SaveProgress()
    {
    }
}

/// <summary>settings.json + progress.json next to the checkpoint (desktop: %LOCALAPPDATA%, Android: app files).</summary>
public sealed class FileSettingsStore : MemorySettingsStore
{
    private readonly string _dir;

    public FileSettingsStore(string dir = null)
    {
        _dir = dir ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BlockedPixelWarriors");
        Settings = Read<GameSettings>("settings.json")?.Normalized() ?? new GameSettings();
        Scenarios = Read<Dictionary<string, ScenarioProgress>>("progress.json") ?? new();
    }

    private T Read<T>(string name) where T : class
    {
        try
        {
            var path = Path.Combine(_dir, name);
            return File.Exists(path) ? JsonSerializer.Deserialize<T>(File.ReadAllText(path)) : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private void Write<T>(string name, T value)
    {
        try
        {
            Directory.CreateDirectory(_dir);
            File.WriteAllText(Path.Combine(_dir, name), JsonSerializer.Serialize(value));
        }
        catch (Exception)
        {
            // No storage: settings last for this session only.
        }
    }

    public override void Save() => Write("settings.json", Settings);

    protected override void SaveProgress() => Write("progress.json", Scenarios);
}
