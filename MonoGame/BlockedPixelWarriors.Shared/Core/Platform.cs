namespace BlockedPixelWarriors;

/// <summary>What the host platform offers (implemented by the Desktop and Android projects).</summary>
public interface IPlatformServices
{
    bool IsMobile { get; }
    /// <summary>Show the virtual joystick and turn buttons from the start.</summary>
    bool PrefersTouchControls { get; }
    string Name { get; }
}

/// <summary>Command-line / launcher options (capture mode for automated screenshots).</summary>
public sealed class LaunchOptions
{
    public string CapturePath { get; private set; }
    public int CaptureFrames { get; private set; } = 90;
    public string Scenario { get; private set; } = "title";
    public int Width { get; private set; }
    public int Height { get; private set; }
    public bool ForceMobileQuality { get; private set; }
    /// <summary>Seconds simulated (no rendering) before the captured frames, with an autopilot.</summary>
    public float Warmup { get; private set; }
    /// <summary>Extra simulated seconds after a scenario's setup (cards / logistics captures).</summary>
    public float Extra { get; private set; }
    /// <summary>Card to play automatically in the cards scenario (-1: none).</summary>
    public int PickCard { get; private set; } = -1;
    /// <summary>Show the touch controls (desktop testing of the phone layout).</summary>
    public bool Touch { get; private set; }
    /// <summary>Capture runs: menu key presses separated by commas (up, down, left, right, enter, back, save).</summary>
    public string MenuScript { get; private set; }
    /// <summary>Capture runs: menu language.</summary>
    public string Lang { get; private set; }

    public static LaunchOptions Parse(string[] args)
    {
        var o = new LaunchOptions();
        for (var i = 0; i < args.Length; i++)
        {
            string Next() => i + 1 < args.Length ? args[++i] : "";
            switch (args[i])
            {
                case "--capture": o.CapturePath = Next(); break;
                case "--frames": o.CaptureFrames = int.Parse(Next()); break;
                case "--scenario": o.Scenario = Next(); break;
                case "--width": o.Width = int.Parse(Next()); break;
                case "--height": o.Height = int.Parse(Next()); break;
                case "--mobile": o.ForceMobileQuality = true; break;
                case "--warmup": o.Warmup = float.Parse(Next(), System.Globalization.CultureInfo.InvariantCulture); break;
                case "--touch": o.Touch = true; break;
                case "--extra": o.Extra = float.Parse(Next(), System.Globalization.CultureInfo.InvariantCulture); break;
                case "--pick": o.PickCard = int.Parse(Next()); break;
                case "--menu": o.MenuScript = Next(); break;
                case "--lang": o.Lang = Next(); break;
            }
        }
        return o;
    }

    public static LaunchOptions Default { get; } = new();
}
