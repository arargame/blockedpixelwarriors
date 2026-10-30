using Android.App;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Android;

/// <summary>
/// Launcher activity: full-screen immersive landscape, keeps the screen on while playing and
/// hosts the shared <see cref="BpwGame"/> (touch joystick + turn buttons are on by default).
/// </summary>
[Activity(
    Label = "@string/app_name",
    MainLauncher = true,
    Icon = "@mipmap/icon",
    Theme = "@style/MainTheme",
    AlwaysRetainTaskState = true,
    LaunchMode = LaunchMode.SingleInstance,
    ScreenOrientation = ScreenOrientation.SensorLandscape,
    ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.Keyboard | ConfigChanges.KeyboardHidden | ConfigChanges.ScreenSize | ConfigChanges.ScreenLayout | ConfigChanges.UiMode | ConfigChanges.SmallestScreenSize)]
public sealed class MainActivity : AndroidGameActivity
{
    private BpwGame _game;
    private View _view;

    protected override void OnCreate(Bundle bundle)
    {
        base.OnCreate(bundle);
        _game = new BpwGame(new AndroidPlatform());
        _view = (View)_game.Services.GetService(typeof(View));
        SetContentView(_view);
        Window?.AddFlags(WindowManagerFlags.KeepScreenOn);
        EnterImmersiveMode();
        _game.Run();
    }

    public override void OnWindowFocusChanged(bool hasFocus)
    {
        base.OnWindowFocusChanged(hasFocus);
        if (hasFocus) EnterImmersiveMode();
    }

    /// <summary>Hides the status and navigation bars (swipe from the edge to show them briefly).</summary>
    private void EnterImmersiveMode()
    {
        if (Build.VERSION.SdkInt >= BuildVersionCodes.R && Window?.InsetsController != null)
        {
            Window.SetDecorFitsSystemWindows(false);
            Window.InsetsController.Hide(WindowInsets.Type.StatusBars() | WindowInsets.Type.NavigationBars());
            Window.InsetsController.SystemBarsBehavior = (int)WindowInsetsControllerBehavior.ShowTransientBarsBySwipe;
        }
        else if (_view != null)
        {
#pragma warning disable CA1422 // legacy path for Android < 11
            _view.SystemUiFlags = SystemUiFlags.LayoutStable | SystemUiFlags.LayoutHideNavigation | SystemUiFlags.LayoutFullscreen
                | SystemUiFlags.HideNavigation | SystemUiFlags.Fullscreen | SystemUiFlags.ImmersiveSticky;
#pragma warning restore CA1422
        }
    }
}

/// <summary>Android platform services: phone UI scale, touch controls, mobile render quality.</summary>
internal sealed class AndroidPlatform : IPlatformServices
{
    public bool IsMobile => true;
    public bool PrefersTouchControls => true;
    public string Name => "Android";
}
