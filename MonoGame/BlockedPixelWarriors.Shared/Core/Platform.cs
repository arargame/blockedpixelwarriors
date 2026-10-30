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
    /// <summary>Show the touch controls (desktop testing of the phone layout).</summary>
    public bool Touch { get; private set; }

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
            }
        }
        return o;
    }

    public static LaunchOptions Default { get; } = new();
}
