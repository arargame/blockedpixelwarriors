using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Gameplay;
using BlockedPixelWarriors.Input;
using BlockedPixelWarriors.Rendering;
using BlockedPixelWarriors.UI;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors;

/// <summary>
/// MonoGame entry (shared by Desktop and Android): owns the device, loads content, routes input
/// to the screens (title, play, pause, game over) and drives the frame: simulate, queue the
/// scene, render with post-processing, draw the HUD on top.
/// </summary>
public sealed class BpwGame : Game
{
    private readonly IPlatformServices _platform;
    private readonly LaunchOptions _options;
    private readonly GraphicsDeviceManager _graphics;
    private AssetStore _assets;
    private ModelLibrary _models;
    private SceneRenderer _renderer;
    private RenderQueue _queue;
    private LightRig _lights;
    private GameSession _session;
    private GameInput _input;
    private UiKit _ui;
    private Hud _hud;
    private CardPicker _cards;
    private RenderQuality _quality;
    private RenderTarget2D _capture;
    private int _frame;
    private float _renderScale = 1;
    private readonly float[] _frameTimes = new float[90];
    private int _frameTimeCount;
    private bool _poster;

    public BpwGame(IPlatformServices platform, LaunchOptions options = null)
    {
        _platform = platform;
        _options = options ?? LaunchOptions.Default;
        _graphics = new GraphicsDeviceManager(this)
        {
            GraphicsProfile = GraphicsProfile.HiDef,
            SynchronizeWithVerticalRetrace = _options.CapturePath == null,
            PreferMultiSampling = false,
            PreferredDepthStencilFormat = DepthFormat.Depth24,
        };
        if (platform.IsMobile)
        {
            _graphics.IsFullScreen = true;
            _graphics.SupportedOrientations = DisplayOrientation.LandscapeLeft | DisplayOrientation.LandscapeRight;
        }
        else
        {
            _graphics.PreferredBackBufferWidth = _options.Width > 0 ? _options.Width : 1600;
            _graphics.PreferredBackBufferHeight = _options.Height > 0 ? _options.Height : 900;
            Window.AllowUserResizing = true;
        }
        IsFixedTimeStep = false;
        IsMouseVisible = !platform.IsMobile;
        Content.RootDirectory = "Content";
        Window.Title = "Blocked Pixel Warriors";
    }

    protected override void LoadContent()
    {
        var device = GraphicsDevice;
        _quality = _platform.IsMobile || _options.ForceMobileQuality ? RenderQuality.Mobile : RenderQuality.High;
        _assets = new AssetStore(device);
        var scene = _assets.Scene();
        _models = new ModelLibrary(device, _assets, scene);
        _lights = LightRig.From(scene);
        _lights.EnvMap = _assets.Environment();
        _renderer = new SceneRenderer(device, _assets, _quality, scene.Post)
        {
            Lights = _lights,
            Sky = new SkyDome(device, _assets.Effect("Sky"), scene.Sky),
        };
        _renderer.Post.LensK = scene.Camera.LensK;
        Console.WriteLine($"[bpw] {device.Adapter.Description} profile={device.GraphicsProfile} hdr={_renderer.Post.HdrSupported} quality={_quality.Name}");
        // Phones: one graded sample without the colour fringe (the MOBILE shader variant).
        if (_quality == RenderQuality.Mobile) _renderer.Post.Fringe = 0;
        _queue = new RenderQueue();
        _ui = new UiKit(device, _assets);
        _hud = new Hud(_ui, _assets.UiTexture("ui_logo")) { ShowQuit = _platform.IsMobile, TouchHelp = _platform.PrefersTouchControls };
        _input = new GameInput(_platform.PrefersTouchControls);
        _session = new GameSession(device, _models, scene, _lights, _quality, _hud);
        _cards = new CardPicker(device, _assets, _models, _renderer.Post, _ui, _lights);
        _session.Cards = _cards;
        _renderer.BackdropWorld = _session.World.Backdrop;
        _renderer.SetSnowMap(_session.World.FloorSnow.Texture, _session.World.FloorSnow.Rect);
        _poster = _options.Scenario is "poster" or "static";
        if (_options.Scenario is "play" or "cards" or "logistics")
        {
            _session.StartRun();
            var vp = Viewport;
            _ui.Scale = UiScale(vp);
            void Sim(float seconds)
            {
                for (float t = 0; t < seconds; t += 1 / 30f)
                {
                    _session.Step(1 / 30f, AutoPilot(_session.Time));
                    _cards.Update(1 / 30f, _input, vp);
                    _hud.CardsOpen = _cards.Open;
                    _hud.Update(1 / 30f, _session.PowerUps.Active);
                }
            }
            // Capture runs: simulate a stretch of play with an autopilot before the frames.
            Sim(_options.Warmup);
            if (_options.Scenario == "logistics")
            {
                // Engineer + cargo chopper contract, a few cargo cubes on the yard, chopper due soon.
                foreach (var id in new[] { "engineer", "cargoChopper", "doubleRow", "surpriseEgg" })
                    _session.ApplyCard(_session.CardDefs.First(d => d.Id == id));
                Sim(14);
                foreach (var (c, r, color) in new[] { (3, 4, BlockColor.Red), (4, 8, BlockColor.Green), (2, 10, BlockColor.Teal), (5, 2, BlockColor.Red) })
                    if (_session.Blocks.Cell(c, r) is not { Alive: true }) _session.Blocks.PlaceBlock(c, r, color, BlockType.Normal, cargo: true);
                Sim(_options.Extra > 0 ? _options.Extra : 20);
            }
            if (_options.Scenario == "cards")
            {
                _session.OfferCards();
                Sim(_options.Extra > 0 ? _options.Extra : 1.6f);
                if (_options.PickCard >= 0)
                {
                    _cards.Pick(_options.PickCard);
                    Sim(0.5f);
                }
            }
        }
        if (_options.Touch) _input.TouchMode = true;
        if (_options.Scenario == "poster") _session.StagePoster();
        if (_options.Scenario == "static") _session.StageStatic();
        if (_options.CapturePath != null)
        {
            var pp = GraphicsDevice.PresentationParameters;
            _capture = new RenderTarget2D(device, pp.BackBufferWidth, pp.BackBufferHeight, false, SurfaceFormat.Color, DepthFormat.Depth24);
        }
    }

    private Rectangle Viewport
    {
        get
        {
            var pp = GraphicsDevice.PresentationParameters;
            return new Rectangle(0, 0, pp.BackBufferWidth, pp.BackBufferHeight);
        }
    }

    /// <summary>Web CSS pixels to screen pixels (desktop: the 941-line key art; phones: bigger UI).</summary>
    private float UiScale(Rectangle vp) => MathF.Max(0.6f, vp.Height / (_platform.IsMobile || _options.Touch ? 430f : 941f));

    protected override void Update(GameTime gameTime)
    {
        var dt = MathF.Min((float)gameTime.ElapsedGameTime.TotalSeconds, 1 / 20f);
        if (_options.CapturePath != null) dt = 1 / 30f;
        var vp = Viewport;
        var k = UiScale(vp);
        _ui.Scale = k;
        var playing = _session.State is GameState.Playing or GameState.Dead;
        _input.Update(vp, k, playing && !_session.Paused);
        HandleScreens();
        // Desktop: F11 / Alt+Enter toggles borderless full screen.
        if (!_platform.IsMobile && (_input.Pressed(Microsoft.Xna.Framework.Input.Keys.F11)
            || (_input.Pressed(Microsoft.Xna.Framework.Input.Keys.Enter) && _input.Down(Microsoft.Xna.Framework.Input.Keys.LeftAlt))))
        {
            _graphics.HardwareModeSwitch = false;
            _graphics.ToggleFullScreen();
        }
        var command = _options.CapturePath != null && _options.Scenario == "play" ? AutoPilot(_session.Time) : _input.Command;
        if (!_session.Paused && !_poster)
        {
            _session.Step(dt, command);
            _cards.Update(dt, _input, vp);
        }
        _hud.CardsOpen = _cards.Open;
        _hud.Update(dt, _session.PowerUps.Active);
        base.Update(gameTime);
    }

    /// <summary>Title / game over: any key or tap starts; pause menu with touch-friendly buttons.</summary>
    private void HandleScreens()
    {
        var s = _session;
        switch (s.State)
        {
            case GameState.Title:
            case GameState.Over:
            case GameState.Won:
                if (_input.BackPressed && _platform.IsMobile)
                {
                    Exit();
                    return;
                }
                if (_input.AnyAction && _hud.Overlay is Overlay.Title or Overlay.GameOver or Overlay.Won) s.StartRun();
                break;
            default:
                if (s.Paused)
                {
                    if (_input.PausePressed)
                    {
                        Resume();
                        break;
                    }
                    foreach (var tap in _input.Taps)
                    {
                        if (_hud.ResumeButton.Contains(tap.Position)) Resume();
                        else if (_hud.RestartButton.Contains(tap.Position)) Restart();
                        else if (_hud.ShowQuit && _hud.QuitButton.Contains(tap.Position)) Exit();
                    }
                    if (_input.Pressed(Microsoft.Xna.Framework.Input.Keys.R)) Restart();
                }
                else if (_input.PausePressed)
                {
                    s.Paused = true;
                    _hud.ShowPause();
                }
                break;
        }
    }

    private void Resume()
    {
        _session.Paused = false;
        _hud.HideOverlay();
    }

    private void Restart()
    {
        _session.Paused = false;
        _session.StartRun();
    }

    /// <summary>Android: pause when the app goes to the background.</summary>
    protected override void OnDeactivated(object sender, EventArgs args)
    {
        base.OnDeactivated(sender, args);
        if (_session is { State: GameState.Playing or GameState.Dead, Paused: false })
        {
            _session.Paused = true;
            _hud.ShowPause();
        }
    }

    protected override void Draw(GameTime gameTime)
    {
        var vp = Viewport;
        var target = _capture;
        AdaptResolution((float)gameTime.ElapsedGameTime.TotalSeconds);
        var maxH = MathF.Min(vp.Height, _quality.MaxRenderHeight);
        var scale = maxH / vp.Height * _renderScale * _quality.Supersample;
        var rw = Math.Max(1, (int)(vp.Width * scale));
        var rh = Math.Max(1, (int)(vp.Height * scale));
        _renderer.Post.Resize(rw, rh);
        var camera = _session.Rig.Camera;
        camera.SetAspect(vp.Width / (float)vp.Height);
        camera.Update();
        _renderer.Time = _session.Time;
        _queue.Clear();
        _session.Submit(_queue);
        _renderer.Render(_queue, camera, target, vp);
        GraphicsDevice.SetRenderTarget(target);
        GraphicsDevice.Viewport = new Viewport(vp);
        if (!_poster)
        {
            _hud.Draw(vp, _session, camera, _input.Touch, _input.TouchMode);
            if (!_session.Paused && _cards.Active)
            {
                _cards.Draw(vp);
                _ui.Begin();
                _cards.DrawUi(vp);
                _ui.End();
            }
        }
        if (target != null) GraphicsDevice.SetRenderTarget(null);
        base.Draw(gameTime);

        if (_options.CapturePath != null && ++_frame >= _options.CaptureFrames)
        {
            using (var fs = File.Create(_options.CapturePath)) _capture.SaveAsPng(fs, _capture.Width, _capture.Height);
            Console.WriteLine($"captured {_options.CapturePath} ({_capture.Width}x{_capture.Height}), draw calls {_renderer.DrawCalls}");
            Exit();
        }
    }

    /// <summary>Scripted stick for automated capture runs (sweeps the board, turns now and then).</summary>
    private static PilotCommand AutoPilot(float t) => new()
    {
        Stick = new Vector2(MathF.Sin(t * 0.45f) * 0.8f, MathF.Sin(t * 0.31f + 1) * 0.6f),
        StickActive = true,
        Turn = MathF.Sin(t * 0.2f) > 0.85f ? 1 : 0,
    };

    /// <summary>Dynamic resolution on phones: lower the render scale when frames run long.</summary>
    private void AdaptResolution(float dt)
    {
        if (!_quality.Adaptive || dt <= 0) return;
        _frameTimes[_frameTimeCount++] = dt;
        if (_frameTimeCount < _frameTimes.Length) return;
        _frameTimeCount = 0;
        var avg = _frameTimes.Average();
        if (avg > 1 / 45f) _renderScale = MathF.Max(0.6f, _renderScale - 0.1f);
        else if (avg < 1 / 58f) _renderScale = MathF.Min(1, _renderScale + 0.05f);
    }

    protected override void UnloadContent()
    {
        _renderer?.Dispose();
        _models?.Dispose();
        _ui?.Dispose();
        _cards?.Dispose();
        _assets?.Dispose();
        _capture?.Dispose();
        base.UnloadContent();
    }
}
