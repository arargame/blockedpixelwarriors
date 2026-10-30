using BlockedPixelWarriors;

// Desktop entry point. Options:
//   --capture <file.png> [--frames N] [--scenario title|play|poster]   render N frames, save, exit
//   --width W --height H                                              window size
var options = LaunchOptions.Parse(args);
using var game = new BpwGame(new DesktopPlatform(), options);
game.Run();

/// <summary>Desktop platform services (keyboard + mouse, windowed).</summary>
internal sealed class DesktopPlatform : IPlatformServices
{
    public bool IsMobile => false;
    public bool PrefersTouchControls => false;
    public string Name => "Desktop";
}
