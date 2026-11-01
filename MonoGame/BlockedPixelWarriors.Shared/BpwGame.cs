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
    private MainMenu _menu;
    private readonly ISettingsStore _store;
    private RenderQuality _quality;
    private RenderTarget2D _capture;
    private int _frame;
    private float _renderScale = 1;
    private readonly float[] _frameTimes = new float[90];
    private int _frameTimeCount;
    private bool _poster;
    private TankLevel _tank;
    private bool _tankMode;
    private SkyDome _sky;

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
        // Settings (OPTIONS): captures use defaults in memory.
        _store = _options.CapturePath != null ? new MemorySettingsStore() : new FileSettingsStore();
        if (_options.Lang != null) _store.Settings.Lang = _options.Lang;
        if (!platform.IsMobile && _options.CapturePath == null && _store.Settings.Fullscreen)
        {
            _graphics.HardwareModeSwitch = false;
            _graphics.IsFullScreen = true;
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
        // OPTIONS · QUALITY (applies at start; captures keep the defaults).
        if (_options.CapturePath == null && _store.Settings.Quality != null) _quality = RenderQuality.ByName(_store.Settings.Quality);
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
        _sky = _renderer.Sky;
        _tank = new TankLevel(_models, scene, _lights.EnvMap, _quality, () => _store.Settings);
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
        _tank.Cards = _cards;
        _tank.Hud = _hud;
        _session.Settings = _store;
        _session.Rig.ShakeScale = _store.Settings.Shake ? 1 : 0;
        _menu = new MainMenu(device, _assets, _ui, _cards, _renderer.Post, scene.Prefabs.Menu, _store, _assets.UiTexture("ui_logo"))
        {
            Compact = _platform.IsMobile || _options.Touch,
            TouchHints = _platform.PrefersTouchControls || _options.Touch,
            RunningQuality = _quality.Name,
            CanContinue = () => _session.CanContinue,
            OnPlay = mode =>
            {
                _hud.MenuMode = false;
                if (mode == "tank") StartTank();
                else if (mode == "continue") _session.ContinueRun();
                else _session.StartRun();
            },
            OnQuit = Exit,
            ToggleFullscreen = _platform.IsMobile ? null : () =>
            {
                _graphics.HardwareModeSwitch = false;
                _graphics.ToggleFullScreen();
                return _graphics.IsFullScreen;
            },
            IsFullscreen = () => _graphics.IsFullScreen,
            OnSettingsChanged = st => _session.Rig.ShakeScale = st.Shake ? 1 : 0,
        };
        _renderer.BackdropWorld = _session.World.Backdrop;
        _renderer.SetSnowMap(_session.World.FloorSnow.Texture, _session.World.FloorSnow.Rect);
        _poster = _options.Scenario is "poster" or "static";
        if (_options.CapturePath != null) _session.Store = new MemoryCheckpointStore();
        if (_options.Scenario is "play" or "cards" or "logistics" or "transit" or "terrace" or "pause" or "warn" or "plasma")
        {
            _session.StartRun();
            var vp = Viewport;
            _ui.Scale = UiScale(vp);
            void Sim(float seconds, Action script = null)
            {
                for (float t = 0; t < seconds; t += 1 / 30f)
                {
                    script?.Invoke();
                    _session.Step(1 / 30f, script != null ? default : AutoPilot(_session.Time));
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
            if (_options.Scenario == "transit")
            {
                // Stage 1 cleared: fly up the line toward the checkpoint gate.
                _session.ClearDepot();
                var h = _session.Heli;
                Sim(_options.Extra > 0 ? _options.Extra : 12, () =>
                {
                    h.Position.Z = MathF.Max(h.Position.Z - 0.3f, -60);
                    h.Position.X += (3 - h.Position.X) * 0.05f;
                });
            }
            if (_options.Scenario == "terrace")
            {
                // CONTINUE from a checkpoint, then hover beside the first crane car as the hauler passes.
                _session.Store = new MemoryCheckpointStore(new CheckpointSave { Score = 1234, Wave = 3, Cards = new List<string> { "flicker" } });
                _session.ContinueRun();
                // Make the 3rd loaded cargo cube a CRT (normally 1 in 100) so the capture shows one.
                _session.ForceCrtSlot(2);
                var h = _session.Heli;
                Sim(_options.Extra > 0 ? _options.Extra : 40, () =>
                {
                    h.Invulnerable = 5;
                    var crane = _session.Train?.Cars.FirstOrDefault(c => c.Cranes.Count > 0);
                    var z = crane != null ? MathHelper.Clamp(crane.World.Translation.Z + 7, -82, -60) : -66;
                    h.Position = new Vector3(-3, GameConfig.Heli.Altitude, z);
                });
            }
            if (_options.Scenario == "plasma")
            {
                // T + D power-ups: the 3D plasma bolts in flight.
                _session.PowerUps.Activate(SupplyType.T, 999);
                _session.PowerUps.Activate(SupplyType.D, 999);
                Sim(_options.Extra > 0 ? _options.Extra : 3.2f, () => _session.Heli.Invulnerable = 5);
            }
            if (_options.Scenario == "warn")
            {
                // Run until a train is announced (edge marker up, train still out of sight).
                for (float t = 0; t < 150 && !(_session.TrainWarnSide != null && (_session.Train == null || _session.Train.Finished)); t += 1 / 30f)
                {
                    _session.Heli.Invulnerable = 5;
                    _session.Step(1 / 30f, default);
                    _hud.Update(1 / 30f, _session.PowerUps.Active);
                }
                Sim(0.5f, () => _session.Heli.Invulnerable = 5);
            }
            if (_options.Scenario == "pause")
            {
                Pause();
                for (float t = 0; t < 0.6f; t += 1 / 30f) _menu.Update(1 / 30f, _input, vp);
                foreach (var step in (_options.MenuScript ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries))
                {
                    _menu.Press(step);
                    for (float t = 0; t < 0.5f; t += 1 / 30f) _menu.Update(1 / 30f, _input, vp);
                }
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
        if (_options.Scenario is "title" or "menu") ShowMenu();
        if (_options.Scenario == "menu" && _options.CapturePath != null)
        {
            // Menu capture: let it come in, then play the scripted presses.
            var vp = Viewport;
            _ui.Scale = UiScale(vp);
            void Sim(float seconds)
            {
                for (float t = 0; t < seconds; t += 1 / 30f)
                {
                    _session.Step(1 / 30f, default);
                    _cards.Update(1 / 30f, _input, vp);
                    _menu.Update(1 / 30f, _input, vp);
                }
            }
            Sim(_options.Warmup > 0 ? _options.Warmup : 3);
            foreach (var step in (_options.MenuScript ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                if (step == "save")
                {
                    _session.Store = new MemoryCheckpointStore(new CheckpointSave { Score = 100, Wave = 1 });
                    _store.Reach(2);
                }
                else _menu.Press(step);
                Sim(0.6f);
            }
        }
        if (_options.Touch) _input.TouchMode = true;
        if (_options.Scenario == "tank")
        {
            // Tank level (same script as the web test): drive from the base along the road into the
            // channel, then an auto gunner (aims at the lowest block) holds position until the
            // fighter is about to pass over (strafe + bomb), --extra seconds more (default 0.5).
            // --pick 1: phase won, the gate opens and the tank drives out along the far road.
            // --pick 3: the skill-card offer.
            StartTank();
            var A = GameConfig.TankArena.BaseX > 0 ? 1 : -1;
            var path = new List<Vector2> { new(40 * A, 4.6f), new(34 * A, 5.8f), new(28 * A, 6.6f), new(22 * A, 6.8f), new(14 * A, 6.8f), new(8 * A, 8), new(0, 9) };
            DriveTank(path, 14);
            if (_options.PickCard == 1)
            {
                _tank.ForceWin();
                DriveTank(new List<Vector2>(), 2.5f);
                DriveTank(new List<Vector2> { new(-8 * A, 7), new(-14 * A, 6.8f), new(-22 * A, 6.8f), new(-28 * A, 7), new(-38 * A, 9.4f), new(-48 * A, 13), new(-62 * A, 16.5f) }, 16);
            }
            else if (_options.PickCard == 3)
            {
                // Skill cards: force an offer, let the cards fly in (then --pick 4 would choose).
                _tank.OfferCards();
                for (float t = 0; t < 2.5f; t += 1 / 30f) _cards.Update(1 / 30f, _input, Viewport);
            }
            else
            {
                // --pick 2: R (homing missiles) active during the fight, a row of supply crates.
                if (_options.PickCard == 2)
                {
                    var tp = _tank.Position;
                    var types = new[] { Gameplay.SupplyType.T, Gameplay.SupplyType.D, Gameplay.SupplyType.R, Gameplay.SupplyType.H };
                    for (var i = 0; i < types.Length; i++) _tank.Supplies.Spawn(types[i], new Vector3(tp.X - 9 + i * 4.5f, 2, tp.Z + 12));
                }
                for (float t = 0; t < 30; t += 1 / 30f)
                {
                    if (_options.PickCard == 2) _tank.Powers[Gameplay.SupplyType.R] = 5;
                    TankFightStep();
                    if (_tank.FighterActive && _tank.Fighter.Position.Y > 0 && _tank.Fighter.IsAlive && _tank.FighterPassLeft < 12) break;
                }
                for (float t = 0; t < (_options.Extra > 0 ? _options.Extra : 0.5f); t += 1 / 30f)
                {
                    if (_options.PickCard == 2) _tank.Powers[Gameplay.SupplyType.R] = 5;
                    TankFightStep();
                }
            }
            Console.WriteLine($"[tank] state {_tank.State} hp {_tank.Hp:0.0} lock {_tank.Locked} dropped {_tank.Dropped} broken {_tank.Broken} drain {_tank.Pile.Count} fighter {_tank.FighterActive} projectiles {_tank.Projectiles.Count} pos {_tank.Position}");
        }
        if (_options.Scenario == "poster") _session.StagePoster();
        if (_options.Scenario == "static") _session.StageStatic();
        if (_options.CapturePath != null)
        {
            var pp = GraphicsDevice.PresentationParameters;
            _capture = new RenderTarget2D(device, pp.BackBufferWidth, pp.BackBufferHeight, false, SurfaceFormat.Color, DepthFormat.Depth24);
        }
    }

    /// <summary>Main menu over a fresh attract-mode depot.</summary>
    private void ShowMenu()
    {
        StopTank();
        _session.ShowAttract();
        _hud.HideOverlay();
        _hud.MenuMode = true;
        _menu.Show();
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
        // Tank level: its own state drives the touch controls (left stick = hull, the two buttons on
        // the right = barrel); the heli session only plays the attract game behind the menu then.
        var playing = _tankMode ? _tank.HudPlaying && !_cards.Active : _session.State is GameState.Playing or GameState.Dead;
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
        if (_tankMode)
        {
            if (!_session.Paused)
            {
                if (_input.PausePressed) PauseTank();
                else _tank.Update(dt, _input, vp);
            }
            // Skill cards (every 200 broken blocks): the picker drives the grey wash while it is up.
            if (!_session.Paused) _cards.Update(dt, _input, vp);
            else _renderer.Post.Ash = 0;
            _menu.Update(dt, _input, vp);
            _tank.Paused = _session.Paused;
            _hud.CardsOpen = _cards.Open;
            _hud.Update(dt, _tank.ActivePowers);
            base.Update(gameTime);
            return;
        }
        if (!_session.Paused && !_poster)
        {
            _session.Step(dt, command);
            _cards.Update(dt, _input, vp);
            _menu.Update(dt, _input, vp);
        }
        else if (_session.Paused) _menu.Update(dt, _input, vp);
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
                // The main menu handles its own input.
                break;
            case GameState.Over:
            case GameState.Won:
                if (_input.BackPressed && _platform.IsMobile)
                {
                    ShowMenu();
                    return;
                }
                _hud.ContinueAvailable = s.CanContinue && _hud.Overlay is Overlay.Title or Overlay.GameOver;
                if (_hud.ContinueAvailable)
                {
                    // CONTINUE: the C key or a tap / click on the green button.
                    var tapped = false;
                    foreach (var tap in _input.Taps) tapped |= _hud.ContinueButton.Contains(tap.Position);
                    if (tapped || _input.Pressed(Microsoft.Xna.Framework.Input.Keys.C))
                    {
                        s.ContinueRun();
                        break;
                    }
                }
                if (_input.AnyAction && _hud.Overlay is Overlay.GameOver or Overlay.Won) ShowMenu();
                break;
            default:
                // Paused: the pause menu handles its own input (MainMenu.Update).
                if (!s.Paused && _input.PausePressed) Pause();
                break;
        }
    }

    /// <summary>Capture helper: drives the tank through waypoints (heading error steering).</summary>
    private void DriveTank(List<Vector2> path, float seconds)
    {
        var wp = 0;
        for (float t = 0; t < seconds; t += 1 / 30f)
        {
            float throttle = 0, turn = 0;
            if (wp < path.Count)
            {
                var p = _tank.Position;
                var target = path[wp];
                if (Vector2.Distance(target, new Vector2(p.X, p.Z)) < 2.5f) wp++;
                else
                {
                    var want = MathF.Atan2(target.X - p.X, target.Y - p.Z);
                    var err = MathHelper.WrapAngle(want - _tank.Heading);
                    throttle = MathF.Abs(err) < 0.6f ? 1 : 0.2f;
                    turn = err > 0.08f ? -1 : err < -0.08f ? 1 : 0;
                }
            }
            _tank.Step(1 / 30f, throttle, turn, null, false);
        }
    }

    /// <summary>Capture helper: aim at the lowest block in the channel and fire.</summary>
    private void TankFightStep()
    {
        TankBlock best = null;
        foreach (var lane in _tank.Blocks.Lanes)
        foreach (var b in lane)
            if (best == null || b.Z < best.Z) best = b;
        _tank.Step(1 / 30f, 0, 0, best != null ? new Vector3(best.X, 0, best.Z) : null, best != null);
    }

    /// <summary>Tank level (menu card IRON TRACKS): its own scene, the heli game is put away.</summary>
    private void StartTank()
    {
        if (!_tank.Available)
        {
            ShowMenu();
            return;
        }
        _tankMode = true;
        _session.ShowAttract();
        // The heli game's HUD, fed by the tank level (score, phase, channel panel, HP, objectives,
        // log, power-ups).
        _hud.MenuMode = false;
        _hud.HideOverlay();
        _tank.Start();
    }

    private void StopTank()
    {
        if (!_tankMode) return;
        _tankMode = false;
        _hud.MenuMode = false;
        _hud.ClearLog();
    }

    private void PauseTank()
    {
        if (_session.Paused || _menu.Visible) return;
        _session.Paused = true;
        _menu.ShowPause(Resume, () =>
        {
            Resume();
            _tank.Start();
        }, () =>
        {
            Resume();
            ShowMenu();
        });
    }

    /// <summary>ESC / P / the touch pause button: the game freezes under the pause menu.</summary>
    private void Pause()
    {
        if (_session.Paused || _menu.Visible || _session.State is not (GameState.Playing or GameState.Dead)) return;
        _session.Paused = true;
        _menu.ShowPause(Resume, () =>
        {
            Resume();
            _session.StartRun();
        }, () =>
        {
            Resume();
            ShowMenu();
        });
    }

    private void Resume()
    {
        _session.Paused = false;
        _hud.HideOverlay();
        _menu.Hide();
    }

    /// <summary>Android: pause when the app goes to the background.</summary>
    protected override void OnDeactivated(object sender, EventArgs args)
    {
        base.OnDeactivated(sender, args);
        Pause();
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
        var camera = _tankMode ? _tank.Camera : _session.Rig.Camera;
        camera.SetAspect(vp.Width / (float)vp.Height);
        camera.Update();
        _renderer.Time = _tankMode ? _tank.Time : _session.Time;
        _renderer.BackdropWorld = _session.World.Backdrop;
        _renderer.Lights = _tankMode ? _tank.Lights : _lights;
        _renderer.Sky = _tankMode ? null : _sky;
        _queue.Clear();
        if (_tankMode) _tank.Submit(_queue);
        else _session.Submit(_queue);
        _renderer.Render(_queue, camera, target, vp);
        GraphicsDevice.SetRenderTarget(target);
        GraphicsDevice.Viewport = new Viewport(vp);
        if (_tankMode)
        {
            _hud.Draw(vp, _tank, camera, _input.Touch, _input.TouchMode);
            DrawTankHud(vp);
            if (!_session.Paused && _cards.Active)
            {
                _cards.Draw(vp);
                _ui.Begin();
                _cards.DrawUi(vp);
                _ui.End();
            }
            if (_menu.Visible)
            {
                _ui.Begin();
                _menu.DrawBack(vp);
                _ui.End();
                _menu.DrawCards();
                _ui.Begin();
                _menu.DrawFront(vp);
                _ui.End();
            }
        }
        else if (!_poster)
        {
            _hud.Draw(vp, _session, camera, _input.Touch, _input.TouchMode);
            if (!_session.Paused && _cards.Active)
            {
                _cards.Draw(vp);
                _ui.Begin();
                _cards.DrawUi(vp);
                _ui.End();
            }
            if (_menu.Visible)
            {
                _ui.Begin();
                _menu.DrawBack(vp);
                _ui.End();
                _menu.DrawCards();
                _ui.Begin();
                _menu.DrawFront(vp);
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

    /// <summary>
    /// Tank level extras on top of the shared HUD (hud.css .tank-hud): the centre banner (phase
    /// clear / lost), the reload bar and the key help, which fades after the first seconds.
    /// </summary>
    private void DrawTankHud(Rectangle vp)
    {
        if (_session.Paused) return;
        var k = _ui.Scale;
        var t = _tank;
        _ui.Begin();
        var cx = vp.Width / 2f;

        // ---- Banner ----
        if (t.Banner is { } bn)
        {
            var c = new Vector2(cx, vp.Height * 0.38f);
            var power = bn.kind == "power";
            var color = bn.kind == "won" ? new Color(0xff, 0xd3, 0x4a) : bn.kind == "lost" ? new Color(0xff, 0x6b, 0x5a) : new Color(0xff, 0xb0, 0x30);
            _ui.TextCentered(_ui.Hud, bn.title, c, (power ? 30 : 46) * k, color, 3 * k, 0.065f);
            if (bn.sub != null)
            {
                var sub = _input.TouchMode ? bn.sub.Replace("ENTER", "TAP") : bn.sub;
                _ui.TextCentered(_ui.Ui, sub, c + new Vector2(0, 40 * k), 16 * k, Color.White * 0.9f, 2 * k);
            }
        }

        // ---- Bottom centre: reload bar, key help (fades out after 12 s) ----
        var y = vp.Height - 18 * k;
        var bw = 180 * k;
        // Reload bar on desktop only (phones: the HP row owns the bottom; the gun fires by itself).
        if (!_input.TouchMode)
        {
            var reload = new RectangleF(cx - bw / 2, y - 7 * k, bw, 7 * k);
            _ui.Rect(reload, Color.Black * 0.45f);
            _ui.Rect(new RectangleF(reload.X, reload.Y, reload.Width * Math.Clamp(t.ReloadRatio, 0, 1), reload.Height), new Color(0xff, 0xb0, 0x2a));
        }
        var helpAlpha = Math.Clamp(13 - t.Time, 0, 1);
        if (helpAlpha > 0 && !_input.TouchMode)
        {
            const string help = "W S drive · A D turn hull · ← → / Q E turn barrel · auto aim & fire · ESC menu";
            var hw = _ui.Ui.Measure(help, 13 * k) + 24 * k;
            _ui.Panel(new RectangleF(cx - hw / 2, y - 34 * k, hw, 22 * k), 8 * k, new Color(15, 22, 30) * 0.55f * helpAlpha);
            _ui.TextCentered(_ui.Ui, help, new Vector2(cx, y - 23 * k), 13 * k, Color.White * 0.92f * helpAlpha);
        }
        _ui.End();
    }

    /// <summary>Scripted stick for automated capture runs (sweeps the board, turns now and then).</summary>
    private PilotCommand AutoPilot(float t) => new()
    {
        Stick = new Vector2(MathF.Sin(t * 0.45f) * 0.8f, MathF.Sin(t * 0.31f + 1) * 0.6f),
        StickActive = true,
        // --touch captures drive the phone controls (nose-relative stick).
        StickNoseRelative = _options.Touch,
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
        _menu?.Dispose();
        _assets?.Dispose();
        _capture?.Dispose();
        base.UnloadContent();
    }
}
