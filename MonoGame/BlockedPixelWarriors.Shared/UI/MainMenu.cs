using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Input;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;

namespace BlockedPixelWarriors.UI;

/// <summary>
/// Main menu (MainMenu.js). The game keeps running behind it (the attract-mode depot, trains
/// passing) drained to ash grey; the menu itself stays in colour.
///   rows (up / down):   PLAY · OPTIONS · EXIT GAME   (slanted plates under the logo)
///   cards (left/right): the row's cards on a carousel (upgrade card model without the ribbon)
///   ENTER / tap:        opens the focused card: briefing + NEW GAME / CONTINUE, a settings panel
///                       or the quit question. ESC / Back goes back.
/// Scenario cards show their stages under the card as lights joined by a line (lit = reached).
/// </summary>
public sealed class MainMenu : IDisposable
{
    private const float CardW = 0.63f, CardH = 0.88f;
    private const float LogoAspect = 874f / 1860f;
    private static readonly Vector3 CameraPos = new(0, 0, 2.45f);
    private static readonly float VisH = 2 * 2.45f * MathF.Tan(MathHelper.ToRadians(15));
    private static readonly float SkewTan = MathF.Tan(MathHelper.ToRadians(14));

    // Palette (menu.css).
    private static readonly Color Gold = new(0xf3, 0xcf, 0x6b);
    private static readonly Color GoldHi = new(0xff, 0xf3, 0xc0);
    private static readonly Color GoldLo = new(0x9a, 0x65, 0x14);
    private static readonly Color Cream = new(0xff, 0xf6, 0xcf);
    private static readonly Color HeadGold = new(0xf6, 0xdc, 0x91);
    private static readonly Color LabelGold = new(0xe9, 0xc4, 0x6a);

    /// <summary>Screen layout in pixels (menuLayout in MainMenu.js).</summary>
    public sealed class Layout
    {
        public float W, H, U;
        public bool Compact;
        public RectangleF Logo, Stage, Panel, PauseLogo, PausePanel;
        public float NavX, NavY, NavW, PlateH, Gap;
        public Vector2 Card;
        public float CardWpx, CardHpx, HeadY, FootY, OpenCx, HintY;

        public static Layout Compute(float W, float H, bool compact)
        {
            compact |= H < 560;
            var u = compact ? H / 430 : H / 941;
            var m = (compact ? 22 : 44) * u;
            var logoW = MathF.Min(W * 0.3f, (compact ? 250 : 500) * u);
            var L = new Layout { W = W, H = H, U = u, Compact = compact };
            L.Logo = new RectangleF(m, (compact ? 8 : 30) * u, logoW, logoW * LogoAspect);
            L.PlateH = (compact ? 46 : 76) * u;
            L.Gap = (compact ? 8 : 16) * u;
            L.NavY = MathF.Max(L.Logo.Bottom + (compact ? 12 : 40) * u, compact ? 0 : H * 0.4f);
            L.NavX = m;
            L.NavW = MathF.Max(logoW, 230 * u);
            var sx = L.Logo.X + MathF.Max(logoW, L.NavW) + (compact ? 22 : 48) * u;
            var sy = (compact ? 10 : 44) * u;
            L.Stage = new RectangleF(sx, sy, W - m * 0.5f - sx, H - (compact ? 40 : 76) * u - sy);
            L.CardHpx = MathF.Min(L.Stage.Height * (compact ? 0.6f : 0.62f), L.Stage.Width * 0.5f * CardH / CardW);
            L.CardWpx = L.CardHpx * CardW / CardH;
            L.Card = new Vector2(L.Stage.X + L.Stage.Width / 2, L.Stage.Y + L.Stage.Height * (compact ? 0.44f : 0.47f));
            L.HeadY = L.Card.Y - L.CardHpx / 2 - (compact ? 12 : 30) * u;
            L.FootY = L.Card.Y + L.CardHpx / 2 + (compact ? 10 : 22) * u;
            var panelW = MathF.Min(L.Stage.Width * 0.56f, 620 * u);
            L.OpenCx = L.Stage.X + MathF.Max(L.CardWpx * 0.5f + 10 * u, (L.Stage.Width - panelW - 30 * u) * 0.5f);
            var px = L.OpenCx + L.CardWpx / 2 + (compact ? 18 : 40) * u;
            L.Panel = new RectangleF(px, L.Card.Y - L.CardHpx * 0.52f, MathF.Min(panelW, L.Stage.Right - px), L.CardHpx * 1.04f);
            L.HintY = H - (compact ? 16 : 30) * u;
            // Pause menu: logo centred at the top, the panel centred under it (pauseLayout).
            var lw = MathF.Min(W * 0.3f, (compact ? 200 : 380) * u);
            L.PauseLogo = new RectangleF((W - lw) / 2, (compact ? 8 : 34) * u, lw, lw * LogoAspect);
            var pw = MathF.Min(W - 40 * u, (compact ? 420 : 500) * u);
            var top = L.PauseLogo.Bottom + (compact ? 6 : 20) * u;
            L.PausePanel = new RectangleF((W - pw) / 2, top, pw, MathF.Max(0, H - top - (compact ? 30 : 70) * u));
            return L;
        }
    }

    private sealed class MenuCard
    {
        public MenuCardData Def;
        public float FocusT, HoverT, Nope, Sweep = -1, Sheen, Opacity, Dim = 1, Glow, SweepAt = -9;
        public Matrix World;
        public bool Visible;
    }

    private sealed class Item
    {
        public string Kind, Key, Label, Text;
        public int Value, Max;
        public bool On, Primary, Danger;
        public Action Act;
    }

    private readonly GraphicsDevice _device;
    private readonly AssetStore _assets;
    private readonly UiKit _ui;
    private readonly CardPicker _cards;
    private readonly PostProcessor _post;
    private readonly MenuData _data;
    private readonly ISettingsStore _store;
    private readonly Texture2D _logo;
    private readonly List<List<MenuCard>> _rows;
    private readonly int[] _cols;
    private readonly float[] _colAnim, _plateOn;
    private readonly Texture2D _soft, _hGrad, _shade;
    private readonly Dictionary<string, Texture2D> _gen = new();
    private readonly List<(RectangleF r, Action act)> _hits = new();
    private Layout _L;
    private string _genKey;
    private int _row, _panelIndex;
    private float _rowAnim, _openT, _time, _introT, _alpha, _footFlash;
    private string _open;
    private string _mode = "main";
    private Action _resume, _restart, _toMainMenu;
    private bool _farewell, _ignoreRelease;
    private (float t, string mode, bool fired)? _leaving;
    private Vector2 _pointer = new(-9999, -9999);
    private Matrix _view, _proj;
    private (int row, int col)? _hover;

    public bool Visible { get; private set; }
    /// <summary>The pause menu is up (the game is frozen under it).</summary>
    public bool Paused => Visible && _mode == "pause";
    public bool Active { get; private set; }
    public float Ash { get; private set; }
    public bool TouchHints { get; set; }
    public bool Compact { get; set; }
    public string RunningQuality { get; set; } = "high";
    public Func<bool> CanContinue { get; set; } = () => false;
    public Action<string> OnPlay { get; set; }
    public Action OnQuit { get; set; }
    /// <summary>Desktop only: toggles full screen and reports the state.</summary>
    public Func<bool> ToggleFullscreen { get; set; }
    public Func<bool> IsFullscreen { get; set; }
    public Action<GameSettings> OnSettingsChanged { get; set; }

    private GameSettings S => _store.Settings;
    private string Lang => S.Lang;

    public MainMenu(GraphicsDevice device, AssetStore assets, UiKit ui, CardPicker cards, PostProcessor post, MenuData data, ISettingsStore store, Texture2D logo)
    {
        _device = device;
        _assets = assets;
        _ui = ui;
        _cards = cards;
        _post = post;
        _data = data;
        _store = store;
        _logo = logo;
        _rows = data.Rows.Select(r => r.Cards.Select(c => new MenuCard { Def = c }).ToList()).ToList();
        _cols = new int[_rows.Count];
        _colAnim = new float[_rows.Count];
        _plateOn = new float[_rows.Count];
        // Soft box (9-slice blur), horizontal fade and the screen shade (menu-shade).
        _soft = Gen(64, 64, (x, y) =>
        {
            float Edge(float v) => MathHelper.Clamp(MathF.Min(v, 64 - v) / 24f, 0, 1);
            var a = Edge(x) * Edge(y);
            a = a * a * (3 - 2 * a);
            return new Vector4(a, a, a, a);
        });
        _hGrad = Gen(256, 1, (x, _) => new Vector4(1 - x / 256f));
        _shade = Gen(256, 1, (x, _) =>
        {
            var t = x / 255f;
            var a = t < 0.28f ? MathHelper.Lerp(0.78f, 0.5f, t / 0.28f) : t < 0.52f ? MathHelper.Lerp(0.5f, 0.12f, (t - 0.28f) / 0.24f) : MathHelper.Lerp(0.12f, 0.22f, (t - 0.52f) / 0.48f);
            return new Vector4(8 / 255f * a, 9 / 255f * a, 12 / 255f * a, a);
        });
    }

    // ---- Strings -------------------------------------------------------------------------------

    public string T(string key, string n = null)
    {
        string s = null;
        if (_data.Text.TryGetValue(Lang, out var d)) d.TryGetValue(key, out s);
        if (s == null && _data.Text.TryGetValue("en", out var en)) en.TryGetValue(key, out s);
        s ??= key;
        return n != null ? s.Replace("{n}", n) : s;
    }

    // ---- Show / hide ---------------------------------------------------------------------------

    public void Show()
    {
        _mode = "main";
        Visible = true;
        Active = false;
        _leaving = null;
        _open = null;
        _openT = 0;
        _introT = 0;
        _alpha = 0;
    }

    public void Hide()
    {
        Visible = false;
        Active = false;
        _open = null;
    }

    /// <summary>
    /// Pause menu: the same panel style centred over the frozen, grey game.
    /// RESUME · OPTIONS (sound / graphics / language) · RESTART · MAIN MENU.
    /// </summary>
    public void ShowPause(Action resume, Action restart, Action mainMenu)
    {
        _mode = "pause";
        _resume = resume;
        _restart = restart;
        _toMainMenu = mainMenu;
        Visible = true;
        Active = false;
        _leaving = null;
        _introT = 0;
        _alpha = 0;
        _open = "pause";
        _openT = 1;
        _panelIndex = 0;
        foreach (var row in _rows)
        foreach (var c in row)
            c.Visible = false;
    }

    /// <summary>BACK: sub panel -> its parent; at the pause menu's top level it resumes.</summary>
    private void Back()
    {
        if (_mode != "pause")
        {
            ClosePanel();
            return;
        }
        if (_open == "pauseOptions") OpenPanel("pause", 1);
        else if (_open is "sound" or "graphics" or "language") OpenPanel("pauseOptions", Array.IndexOf(new[] { "sound", "graphics", "language" }, _open));
        else _resume?.Invoke();
    }

    /// <summary>Plays the chosen card into the game, then calls OnPlay(mode).</summary>
    public void Start(string mode)
    {
        if (!Active) return;
        Active = false;
        _leaving = (0, mode, false);
        _open = null;
    }

    // ---- Navigation ----------------------------------------------------------------------------

    private MenuCard Focused => _rows[_row][_cols[_row]];

    public void SetRow(int i)
    {
        i = Math.Clamp(i, 0, _rows.Count - 1);
        if (i == _row && _open == null) return;
        _open = null;
        _row = i;
        Focused.Sweep = -0.9f;
    }

    public void SetCol(int i)
    {
        var n = _rows[_row].Count;
        i = Math.Clamp(i, 0, n - 1);
        if (i == _cols[_row])
        {
            Focused.Nope = 1;
            return;
        }
        _cols[_row] = i;
        Focused.Sweep = -0.9f;
    }

    /// <summary>ENTER / tap on the focused card.</summary>
    public void Activate()
    {
        var d = Focused.Def;
        if (d.Locked)
        {
            Focused.Nope = 1;
            _footFlash = 0.5f;
            return;
        }
        OpenPanel(d.Scenario ? "scenario" : d.Panel);
    }

    public void OpenPanel(string kind, int index = 0)
    {
        _open = kind;
        _panelIndex = index;
        _farewell = false;
    }

    private void ClosePanel()
    {
        if (_mode != "pause") _open = null;
    }

    private List<Item> PanelItems()
    {
        var items = new List<Item>();
        var back = new Item { Kind = "button", Label = T("back"), Act = Back };
        switch (_open)
        {
            case "pause":
                items.Add(new Item { Kind = "button", Label = T("resume"), Primary = true, Act = () => _resume?.Invoke() });
                items.Add(new Item { Kind = "button", Label = T("options"), Act = () => OpenPanel("pauseOptions") });
                items.Add(new Item { Kind = "button", Label = T("restart"), Act = () => _restart?.Invoke() });
                items.Add(new Item { Kind = "button", Label = T("mainMenu"), Act = () => _toMainMenu?.Invoke() });
                break;
            case "pauseOptions":
                items.Add(new Item { Kind = "button", Label = T("soundTitle"), Act = () => OpenPanel("sound") });
                items.Add(new Item { Kind = "button", Label = T("graphicsTitle"), Act = () => OpenPanel("graphics") });
                items.Add(new Item { Kind = "button", Label = T("languageTitle"), Act = () => OpenPanel("language") });
                items.Add(back);
                break;
            case "scenario":
                var cont = CanContinue();
                if (cont) items.Add(new Item { Kind = "button", Label = T("continueStage"), Primary = true, Act = () => Start("continue") });
                items.Add(new Item { Kind = "button", Label = T("newGame"), Primary = !cont, Act = () => Start("new") });
                items.Add(new Item { Kind = "button", Label = T("back"), Act = ClosePanel });
                break;
            case "sound":
                foreach (var k in new[] { "master", "music", "sfx" }) items.Add(new Item { Kind = "slider", Key = k, Label = T(k), Value = S.Get(k), Max = 10 });
                items.Add(back);
                break;
            case "graphics":
                items.Add(new Item { Kind = "cycle", Key = "quality", Label = T("quality"), Text = S.Quality != null ? T(S.Quality) : $"{T("auto")} · {T(RunningQuality)}" });
                items.Add(new Item { Kind = "cycle", Key = "shake", Label = T("shake"), Text = T(S.Shake ? "on" : "off") });
                if (ToggleFullscreen != null) items.Add(new Item { Kind = "cycle", Key = "fullscreen", Label = T("fullscreen"), Text = T(IsFullscreen?.Invoke() == true ? "on" : "off") });
                items.Add(back);
                break;
            case "language":
                foreach (var l in _data.Languages)
                {
                    var lang = l;
                    items.Add(new Item { Kind = "radio", Label = _data.LanguageNames[l], On = S.Lang == l, Act = () => SetSetting(s => s.Lang = lang) });
                }
                items.Add(back);
                break;
            case "exit":
                items.Add(new Item { Kind = "button", Label = T("yes"), Danger = true, Act = Quit });
                items.Add(new Item { Kind = "button", Label = T("no"), Act = ClosePanel });
                break;
        }
        return items;
    }

    private void SetSetting(Action<GameSettings> change)
    {
        change(S);
        _store.Save();
        OnSettingsChanged?.Invoke(S);
    }

    private void Adjust(Item item, int dir)
    {
        if (item == null) return;
        if (item.Kind == "slider") SetSetting(s => s.Set(item.Key, Math.Clamp(s.Get(item.Key) + dir, 0, item.Max)));
        else if (item.Kind == "cycle")
        {
            if (item.Key == "quality")
            {
                var c = GameSettings.QualityCycle;
                var i = Array.IndexOf(c, S.Quality);
                SetSetting(s => s.Quality = c[((i + dir) % c.Length + c.Length) % c.Length]);
            }
            else if (item.Key == "fullscreen")
            {
                var on = ToggleFullscreen?.Invoke() ?? false;
                SetSetting(s => s.Fullscreen = on);
            }
            else SetSetting(s => s.Shake = !s.Shake);
        }
        else if (item.Kind == "radio" && dir != 0)
        {
            var langs = _data.Languages;
            var i = langs.IndexOf(S.Lang);
            SetSetting(s => s.Lang = langs[((i + dir) % langs.Count + langs.Count) % langs.Count]);
        }
    }

    private void ActivatePanel(int i)
    {
        var items = PanelItems();
        if (i < 0 || i >= items.Count) return;
        _panelIndex = i;
        var it = items[i];
        if (it.Kind is "button" or "radio") it.Act();
        else Adjust(it, 1);
    }

    private void Quit()
    {
        _farewell = true;
        OnQuit?.Invoke();
    }

    // ---- Update --------------------------------------------------------------------------------

    private static float Ease(float t) => 1 - MathF.Pow(1 - MathX.Clamp01(t), 3);

    private static float EaseInOut(float t)
    {
        var x = MathX.Clamp01(t);
        return x < 0.5f ? 4 * x * x * x : 1 - MathF.Pow(-2 * x + 2, 3) / 2;
    }

    private static float EaseBack(float t)
    {
        var x = MathX.Clamp01(t) - 1;
        return 1 + 2.2f * x * x * x + 1.2f * x * x;
    }

    private Vector2 World(float px, float py)
    {
        var aspect = _L.W / _L.H;
        return new Vector2((px / _L.W * 2 - 1) * VisH * aspect / 2, -(py / _L.H * 2 - 1) * VisH / 2);
    }

    /// <summary>Every frame (the game keeps running underneath).</summary>
    public void Update(float dt, GameInput input, Rectangle vp)
    {
        var target = Visible && !(_leaving is { } l && l.t > 0.35f) ? 1 : 0;
        Ash += (target - Ash) * (1 - MathF.Exp(-(target > 0 ? 4 : 3) * dt));
        if (target == 0 && Ash < 0.002f) Ash = 0;
        if (Ash > 0) _post.Ash = MathF.Max(_post.Ash, Ash);
        if (!Visible) return;
        _time += dt;
        _introT += dt;
        _alpha = _leaving is { } lv ? 1 - EaseInOut((lv.t - 0.2f) / 0.55f) : MathX.Clamp01(_introT / 0.45f);
        _L = Layout.Compute(vp.Width, vp.Height, Compact);
        if (!Active && _leaving == null && _introT > (_mode == "pause" ? 0.12f : 0.35f)) Active = true;
        if (Active) HandleInput(input);
        if (_mode == "pause")
        {
            _openT = 1;
            return;
        }
        float Follow(float a, float b, float rate) => a + (b - a) * (1 - MathF.Exp(-rate * dt));
        _rowAnim = Follow(_rowAnim, _row, 9);
        _openT = Follow(_openT, _open != null ? 1 : 0, 10);
        if (_footFlash > 0) _footFlash = MathF.Max(0, _footFlash - dt);
        for (var i = 0; i < _plateOn.Length; i++) _plateOn[i] = Follow(_plateOn[i], i == _row ? 1 : 0, 12);

        var aspect = _L.W / _L.H;
        _view = Matrix.CreateLookAt(CameraPos, Vector3.Zero, Vector3.Up);
        _proj = Matrix.CreatePerspectiveFieldOfView(MathHelper.ToRadians(30), aspect, 0.1f, 20);
        var k = _L.CardHpx / _L.H * VisH / CardH;
        var b = World(_L.Card.X, _L.Card.Y);
        var ob = World(_L.OpenCx, _L.Card.Y);
        _hover = Active ? HitCard(_pointer) : null;
        for (var ri = 0; ri < _rows.Count; ri++)
        {
            _colAnim[ri] = Follow(_colAnim[ri], _cols[ri], 10);
            var rd = ri - _rowAnim;
            var rowFade = MathX.Clamp01(1 - MathF.Abs(rd) * 1.6f);
            for (var ci = 0; ci < _rows[ri].Count; ci++)
            {
                var c = _rows[ri][ci];
                var d = ci - _colAnim[ri];
                var ad = MathF.Abs(d);
                var isFocus = ri == _row && ci == _cols[ri];
                var intro = EaseInOut((_introT - 0.1f - ci * 0.08f - (ri == _row ? 0 : 0.2f)) / 0.6f);
                var x = MathF.Sign(d) * (ad <= 1 ? ad * 0.74f : 0.74f + (ad - 1) * 0.42f);
                var y = -rd * 1.18f;
                var z = -MathF.Min(ad, 2) * 0.24f;
                var ry = -MathHelper.Clamp(d, -1, 1) * 0.55f;
                float rx = 0, rz = 0;
                var scale = 1 - MathF.Min(ad, 2) * 0.15f;
                var dim = 1 - MathF.Min(ad, 1) * 0.5f;
                var fade = rowFade * MathX.Clamp01(2.3f - ad);
                x += (1 - intro) * 1.6f;
                ry += (1 - intro) * -0.9f;
                fade *= intro;
                c.FocusT = Follow(c.FocusT, isFocus ? 1 : 0, 8);
                var hovered = _hover is { } h && h.row == ri && h.col == ci;
                c.HoverT = Follow(c.HoverT, hovered && _open == null ? 1 : 0, 10);
                y += MathF.Sin(_time * 1.5f + ci) * 0.01f * c.FocusT;
                if (c.HoverT > 0.001f && isFocus)
                {
                    var wp = World(_pointer.X, _pointer.Y);
                    ry += MathHelper.Clamp((wp.X - b.X) / (k * 0.4f), -1, 1) * 0.22f * c.HoverT;
                    rx += -MathHelper.Clamp((wp.Y - b.Y) / (k * 0.5f), -1, 1) * 0.16f * c.HoverT;
                }
                if (c.Nope > 0)
                {
                    c.Nope = MathF.Max(0, c.Nope - dt * 2.2f);
                    x += MathF.Sin(c.Nope * 30) * 0.035f * c.Nope;
                }
                scale *= 1 + c.HoverT * 0.04f;
                var px = b.X;
                if (ri == _row)
                {
                    if (isFocus) px = MathHelper.Lerp(b.X, ob.X, EaseInOut(_openT));
                    else fade *= 1 - _openT;
                }
                var glow = c.FocusT * 0.35f + c.HoverT * 0.25f;
                if (_leaving is { } lea && isFocus)
                {
                    var a = EaseInOut(lea.t / 0.7f);
                    z += a * 1.2f;
                    scale *= 1 + a * 0.3f;
                    rz += a * 0.12f;
                    fade *= 1 - EaseInOut((lea.t - 0.25f) / 0.45f);
                    glow = 0.6f * (1 - a);
                }
                else if (_leaving is { } lea2) fade *= 1 - EaseInOut(lea2.t / 0.35f);
                c.Opacity = fade;
                c.Visible = fade > 0.003f;
                c.Dim = dim * (0.55f + 0.45f * rowFade);
                c.Glow = glow * fade;
                c.World = Matrix.CreateScale(scale * k) * MathX.RotationXYZ(rx, ry, rz) * Matrix.CreateTranslation(px + x * k, b.Y + y * k, z * k);
                if (c.Sweep < 1.2f) c.Sweep += dt * 1.5f;
                if (isFocus && hovered && c.Sweep >= 1.2f && _time - c.SweepAt > 2.5f)
                {
                    c.Sweep = -0.9f;
                    c.SweepAt = _time;
                }
                c.Sheen = 0.45f * c.FocusT + 0.25f;
            }
        }
        if (_leaving is { } lt)
        {
            var t = lt.t + dt;
            var fired = lt.fired;
            if (!fired && t > 0.45f)
            {
                fired = true;
                OnPlay?.Invoke(lt.mode);
            }
            _leaving = (t, lt.mode, fired);
            if (t > 0.85f) Hide();
        }
    }

    private void HandleInput(GameInput input)
    {
        if (input.PointerMoved || input.Taps.Count > 0) _pointer = input.Pointer;
        TouchHints = input.TouchMode;
        // Buttons act on press (like the web's pointerdown); cards on release (swipe or click).
        foreach (var tap in input.Taps)
        {
            _pointer = tap.Position;
            var hit = _hits.FindLast(h => h.r.Contains(tap.Position));
            if (hit.act != null)
            {
                hit.act();
                _ignoreRelease = true;
            }
        }
        foreach (var r in input.Releases)
        {
            if (_ignoreRelease)
            {
                _ignoreRelease = false;
                continue;
            }
            var dx = r.End.X - r.Start.X;
            if (_open == null && MathF.Abs(dx) > 40 * _L.U)
            {
                SetCol(_cols[_row] + (dx < 0 ? 1 : -1));
                continue;
            }
            var hit = HitCard(r.Start);
            if (hit == null)
            {
                if (_open != null && !_L.Panel.Contains(r.End)) ClosePanel();
                continue;
            }
            var (row, col) = hit.Value;
            if (row != _row) SetRow(row);
            else if (col != _cols[_row]) SetCol(col);
            else if (_open == null) Activate();
        }
        if (input.Wheel != 0 && _open == null) SetCol(_cols[_row] + (input.Wheel > 0 ? -1 : 1));

        bool P(params Keys[] keys) => keys.Any(input.Pressed);
        var up = P(Keys.Up, Keys.W);
        var down = P(Keys.Down, Keys.S);
        var left = P(Keys.Left, Keys.A);
        var right = P(Keys.Right, Keys.D);
        var enter = P(Keys.Enter, Keys.Space);
        var back = P(Keys.Escape, Keys.Back) || input.BackPressed || (_mode == "pause" && P(Keys.P));
        KeyNav(up, down, left, right, enter, back, P(Keys.C), input.BackPressed);
    }

    /// <summary>Scripted key press (automated captures): up, down, left, right, enter, back.</summary>
    public void Press(string key) => KeyNav(key == "up", key == "down", key == "left", key == "right", key == "enter", key == "back", false, false);

    private void KeyNav(bool up, bool down, bool left, bool right, bool enter, bool back, bool c, bool androidBack)
    {
        if (_open != null)
        {
            var items = PanelItems();
            if (up) _panelIndex = (_panelIndex - 1 + items.Count) % items.Count;
            else if (down) _panelIndex = (_panelIndex + 1) % items.Count;
            else if (left || right) Adjust(items[Math.Clamp(_panelIndex, 0, items.Count - 1)], left ? -1 : 1);
            else if (enter) ActivatePanel(_panelIndex);
            else if (back) Back();
            return;
        }
        if (up) SetRow(_row - 1);
        else if (down) SetRow(_row + 1);
        else if (left) SetCol(_cols[_row] - 1);
        else if (right) SetCol(_cols[_row] + 1);
        else if (enter) Activate();
        else if (c && CanContinue()) Start("continue");
        else if (androidBack)
        {
            // Android back on the menu: straight to the quit question.
            SetRow(_rows.Count - 1);
            OpenPanel("exit");
        }
    }

    /// <summary>Card of the current row under a screen point (ray vs. the card plane).</summary>
    private (int row, int col)? HitCard(Vector2 screen)
    {
        if (_L == null) return null;
        var ndc = new Vector2(screen.X / _L.W * 2 - 1, -(screen.Y / _L.H * 2 - 1));
        var inv = Matrix.Invert(_view * _proj);
        var near = Unproject(new Vector3(ndc, 0), inv);
        var far = Unproject(new Vector3(ndc, 1), inv);
        (int, int)? best = null;
        var bestD = float.MaxValue;
        var row = _rows[_row];
        for (var ci = 0; ci < row.Count; ci++)
        {
            var c = row[ci];
            if (!c.Visible || c.Opacity < 0.3f) continue;
            var toLocal = Matrix.Invert(c.World);
            var o = Vector3.Transform(near, toLocal);
            var d = Vector3.Transform(far, toLocal) - o;
            if (MathF.Abs(d.Z) < 1e-6f) continue;
            var t = -o.Z / d.Z;
            if (t < 0) continue;
            var p = o + d * t;
            if (MathF.Abs(p.X) > CardW / 2 || MathF.Abs(p.Y) > CardH / 2) continue;
            var dist = Vector3.Distance(near, Vector3.Transform(p, c.World));
            if (dist < bestD)
            {
                bestD = dist;
                best = (_row, ci);
            }
        }
        return best;
    }

    private static Vector3 Unproject(Vector3 ndc, in Matrix inverseViewProj)
    {
        var p = Vector4.Transform(new Vector4(ndc, 1), inverseViewProj);
        return new Vector3(p.X, p.Y, p.Z) / p.W;
    }

    // ---- Draw ----------------------------------------------------------------------------------

    /// <summary>Darkening behind everything (menu-shade), with the HUD batch begun.</summary>
    public void DrawBack(Rectangle vp)
    {
        if (!Visible || _L == null) return;
        var a = _alpha;
        if (_mode == "pause")
        {
            _ui.Rect(vp, new Color(8, 9, 12) * (0.45f * a));
            _ui.Vignette(vp, Color.Black * (0.55f * a));
            return;
        }
        _ui.Batch.Draw(_shade, new Rectangle(vp.X, vp.Y, vp.Width, vp.Height), Color.White * a);
        _ui.Vignette(vp, Color.Black * (0.45f * a));
    }

    /// <summary>The 3D cards (own depth, full resolution).</summary>
    public void DrawCards()
    {
        if (!Visible || _L == null || _mode == "pause") return;
        _cards.BeginCards(_view, _proj);
        foreach (var row in _rows)
        foreach (var c in row)
        {
            if (!c.Visible) continue;
            var d = c.Def;
            var front = _assets.Texture($"card_menu_{d.Id}_{Lang}");
            _cards.DrawCard(new CardPicker.CardLook
            {
                World = c.World, Front = front, Art = front, Jewel = Vec(d.Jewel), Glow = Vec(d.Glow), GlowOpacity = c.Glow,
                Fade = c.Opacity, Sheen = c.Sheen, Sweep = c.Sweep, Dim = MathF.Max(0.01f, c.Dim), NoRibbon = true, GoldHex = d.Locked ? 0xa8adb5u : 0,
            });
        }
        _cards.EndCards();
    }

    private static Vector3 Vec(float[] v) => v is { Length: >= 3 } ? new Vector3(v[0], v[1], v[2]) : Vector3.One;

    /// <summary>Logo, plates, header, arrows, stage lights, panel and hints (HUD batch begun).</summary>
    public void DrawFront(Rectangle vp)
    {
        _hits.Clear();
        if (!Visible || _L == null) return;
        var L = _L;
        var u = L.U;
        var a = _alpha;
        EnsureTextures();
        if (_mode == "pause")
        {
            var pl = L.PauseLogo;
            _ui.Texture(_logo, new RectangleF(pl.X, pl.Y + 10 * u, pl.Width, pl.Height), Color.Black * (0.4f * a));
            _ui.Texture(_logo, pl, Color.White * a);
            DrawPanel(a, 0);
            var ph = TouchHints ? T("hintPauseTouch") : T("hintPause");
            _ui.TextCentered(_ui.Ui, ph, new Vector2(L.W / 2, L.HintY), 12 * u, Color.White * (0.55f * a), 0, 3 * u / (12 * u));
            return;
        }

        // Logo.
        var lt = EaseBack(_introT / 0.8f);
        var la = MathX.Clamp01(_introT / 0.5f) * a;
        var ls = 0.92f + 0.08f * lt;
        var lr = new RectangleF(L.Logo.Center.X - L.Logo.Width * ls / 2, L.Logo.Y - 30 * u * (1 - lt) + L.Logo.Height * (1 - ls) / 2, L.Logo.Width * ls, L.Logo.Height * ls);
        _ui.Texture(_logo, new RectangleF(lr.X, lr.Y + 10 * u, lr.Width, lr.Height), Color.Black * (0.4f * la));
        _ui.Texture(_logo, lr, Color.White * la);

        // Link line from the selected plate to the stage.
        var linkY = L.NavY + _rowAnim * (L.PlateH + L.Gap) + L.PlateH / 2;
        var linkX = L.NavX + L.NavW;
        var linkW = MathF.Max(0, L.Stage.X - linkX - 6);
        _ui.Batch.Draw(_hGrad, new Vector2(linkX, linkY - u), null, Gold * (0.9f * a * (1 - _openT * 0)), 0, Vector2.Zero, new Vector2(linkW / 256f, 2 * u), SpriteEffects.None, 0);

        // Plates.
        for (var i = 0; i < _rows.Count; i++) DrawPlate(i, a);

        // Stage header, arrows, footer (fade out while a panel is open).
        var sa = a * (1 - _openT);
        var row = _data.Rows[_row];
        if (sa > 0.01f)
        {
            var title = T(row.Head);
            var count = row.Cards.Count > 1 ? $"{_cols[_row] + 1} / {row.Cards.Count}" : "";
            var tpx = (L.Compact ? 18 : 26) * u;
            var tsp = (L.Compact ? 4 : 6) * u / tpx;
            var cpx = 13 * u;
            var tw = _ui.Serif.Measure(title, tpx, tsp);
            var cw = count.Length > 0 ? _ui.Ui.Measure(count, cpx, 2 * u / cpx) + 16 * u : 0;
            var x0 = L.Stage.Center.X - (tw + cw) / 2;
            var ty = L.HeadY - tpx * 1.05f;
            for (var g = 0; g < 8; g++)
            {
                var ang = g * MathF.PI / 4;
                _ui.Serif.Draw(_ui.Batch, title, new Vector2(x0, ty) + new Vector2(MathF.Cos(ang), MathF.Sin(ang)) * 6 * u, tpx, new Color(255, 200, 90) * (0.04f * sa), tsp);
            }
            _ui.Serif.DrawShadowed(_ui.Batch, title, new Vector2(x0, ty), tpx, HeadGold * sa, new Color(0x1a, 0x10, 0x04) * sa, new Vector2(0, 2 * u), tsp);
            if (cw > 0) _ui.Ui.Draw(_ui.Batch, count, new Vector2(x0 + tw + 16 * u, ty + tpx - cpx * 1.05f), cpx, Color.White * (0.6f * sa), 2 * u / cpx);
            // Arrows hug the focused card.
            var ax = L.CardWpx / 2 + (L.Compact ? 10 : 22) * u;
            var r = 26 * u;
            var lc = new Vector2(MathF.Max(L.Stage.X, L.Card.X - ax - 52 * u) + r, L.Card.Y);
            var rc = new Vector2(MathF.Min(L.Stage.Right, L.Card.X + ax + 52 * u) - r, L.Card.Y);
            DrawArrow(lc, r, "‹", _cols[_row] > 0, sa, -1);
            DrawArrow(rc, r, "›", _cols[_row] < row.Cards.Count - 1, sa, 1);
            DrawFoot(sa);
        }

        // Panel.
        if (_openT > 0.01f && _open != null) DrawPanel(a * _openT, 40 * u * (1 - _openT));

        // Hint + brand.
        var hint = TouchHints ? T("hintTouch") : T("hintKeys");
        var hpx = 12 * u;
        _ui.TextCentered(_ui.Ui, hint, new Vector2(L.W / 2, L.HintY), hpx, Color.White * (0.55f * a), 0, 3 * u / hpx);
        if (!L.Compact)
        {
            var bpx = 12 * u;
            _ui.Serif.Draw(_ui.Batch, "ARARGAMES", new Vector2(44 * u, L.H - 22 * u - bpx * 1.1f), bpx, Gold * (0.5f * a), 6 * u / bpx);
        }
    }

    private void DrawArrow(Vector2 c, float r, string glyph, bool on, float a, int dir)
    {
        var u = _L.U;
        var al = a * (on ? 1 : 0.15f);
        _ui.SoftDisc(c, r * 1.6f, new Color(255, 190, 80) * (0.12f * al));
        _ui.Disc(c, r, new Color(14, 10, 8) * (0.62f * al));
        _ui.Ring(c, r - u, 2 * u, Gold * (0.75f * al));
        _ui.TextCentered(_ui.Hud, glyph, c + new Vector2(0, -3 * u), 40 * u, Gold * al);
        if (on) _hits.Add((new RectangleF(c.X - r, c.Y - r, r * 2, r * 2), () => { if (_open == null) SetCol(_cols[_row] + dir); }));
    }

    private void DrawPlate(int i, float a)
    {
        var L = _L;
        var u = L.U;
        var on = _plateOn[i];
        var t = EaseInOut((_introT - 0.15f - i * 0.08f) / 0.5f);
        var pa = a * t;
        var x = L.NavX - 60 * u * (1 - t) + 14 * u * on;
        var y = L.NavY + i * (L.PlateH + L.Gap);
        var w = L.NavW;
        var h = L.PlateH;
        var s = h * SkewTan;
        var r = new RectangleF(x, y, w, h);
        _hits.Add((new RectangleF(L.NavX, y, w, h), () => SetRow(i)));
        // Shadow + glow, then the plate (normal and selected cross-fade), then the accent bar.
        SoftBox(new RectangleF(r.X, r.Y + 6 * u, w, h), 16 * u, Color.Black * (0.35f * pa));
        if (on > 0.01f) SoftBox(r, 26 * u, new Color(255, 190, 80) * (0.38f * on * pa));
        var plate = _gen["plate"];
        var plateOn = _gen["plateOn"];
        _ui.Batch.Draw(plate, new Vector2(r.X - s / 2, r.Y), null, Color.White * (pa * (1 - on)), 0, Vector2.Zero, new Vector2((w + s) / plate.Width, h / plate.Height), SpriteEffects.None, 0);
        _ui.Batch.Draw(plateOn, new Vector2(r.X - s / 2, r.Y), null, Color.White * (pa * on), 0, Vector2.Zero, new Vector2((w + s) / plateOn.Width, h / plateOn.Height), SpriteEffects.None, 0);
        var bar = _gen["bar"];
        var barOn = _gen["barOn"];
        var bx = r.X - 4 * u - s / 2;
        _ui.Batch.Draw(bar, new Vector2(bx, r.Y), null, Color.White * (pa * (1 - on)), 0, Vector2.Zero, new Vector2((8 * u + s) / bar.Width, h / bar.Height), SpriteEffects.None, 0);
        _ui.Batch.Draw(barOn, new Vector2(bx, r.Y), null, Color.White * (pa * on), 0, Vector2.Zero, new Vector2((8 * u + s) / barOn.Width, h / barOn.Height), SpriteEffects.None, 0);
        // Number, label, sub caption, chevron.
        var rowData = _data.Rows[i];
        var npx = (L.Compact ? 14 : 18) * u;
        var lpx = (L.Compact ? 22 : 30) * u;
        var spx = 13 * u;
        var cx = r.X + 30 * u;
        var cy = r.Center.Y;
        var num = $"0{i + 1}";
        _ui.Serif.Draw(_ui.Batch, num, new Vector2(cx, cy - npx * 0.55f), npx, Color.Lerp(Gold * 0.5f, Gold, on) * pa);
        cx += _ui.Serif.Measure(num, npx) + 16 * u;
        var label = T(rowData.Label);
        var sub = T(rowData.Sub);
        var textH = L.Compact ? lpx : lpx + 2 * u + spx * 1.15f;
        var ty = cy - textH / 2;
        var lcol = Color.Lerp(Color.White * 0.6f, Cream, on) * pa;
        if (on > 0.01f)
        {
            for (var g = 0; g < 8; g++)
            {
                var ang = g * MathF.PI / 4;
                _ui.Hud.Draw(_ui.Batch, label, new Vector2(cx, ty) + new Vector2(MathF.Cos(ang), MathF.Sin(ang)) * 7 * u, lpx, new Color(255, 200, 90) * (0.05f * on * pa), 2 * u / lpx);
            }
        }
        _ui.Hud.DrawShadowed(_ui.Batch, label, new Vector2(cx, ty), lpx, lcol, Color.Lerp(Color.Black * 0.65f, new Color(0x3a, 0x22, 0x08), on) * pa, new Vector2(0, 3 * u), 2 * u / lpx);
        if (!L.Compact) _ui.Ui.Draw(_ui.Batch, sub, new Vector2(cx, ty + lpx + 2 * u), spx, Color.Lerp(Color.White * 0.42f, LabelGold, on) * pa, u / spx);
        if (on > 0.01f)
        {
            var chev = (L.Compact ? 28 : 40) * u;
            var bob = (0.5f - 0.5f * MathF.Cos(_time * MathF.PI * 2)) * 6 * u;
            var cw = _ui.Hud.Measure("›", chev);
            _ui.Hud.Draw(_ui.Batch, "›", new Vector2(r.Right - 26 * u - cw + bob, cy - chev * 0.62f), chev, Gold * (on * pa));
        }
    }

    /// <summary>Under the focused card: stage lights for scenarios, current values for option cards.</summary>
    private void DrawFoot(float a)
    {
        var L = _L;
        var u = L.U;
        var d = Focused.Def;
        var cx = L.Stage.Center.X;
        var y = L.FootY;
        if (d.Scenario || d.Locked)
        {
            var p = d.Scenario ? _store.Progress(d.Id) : new ScenarioProgress { Best = 0 };
            var at = d.Scenario ? (CanContinue() ? 2 : 1) : 0;
            var line = (L.Compact ? 60 : 110) * u;
            var widths = new[] { 20 * u, 20 * u, 28 * u };
            var total = widths.Sum() + 2 * (line + 12 * u);
            var x = cx - total / 2;
            var rowY = y + 14 * u;
            string[] names = { T("stepDepot"), T("stepTerrace"), T("stepBoss") };
            for (var i = 0; i < 3; i++)
            {
                var lit = i < p.Best;
                if (i > 0)
                {
                    var lx = x + 6 * u;
                    var prevLit = i < p.Best;
                    if (prevLit) SoftBox(new RectangleF(lx, rowY - 1.5f * u, line, 3 * u), 10 * u, new Color(255, 200, 80) * (0.7f * a));
                    _ui.Rect(new RectangleF(lx, rowY - 1.5f * u, line, 3 * u), (prevLit ? Gold : Color.White * 0.24f) * a);
                    x += line + 12 * u;
                }
                var c = new Vector2(x + widths[i] / 2, rowY);
                var pulse = at == i + 1 ? 0.5f - 0.5f * MathF.Cos(_time * MathF.PI * 2 / 1.3f) : 0;
                if (i == 2) DrawBossNode(c, lit, a, pulse);
                else DrawNode(c, 10 * u * (1 + 0.18f * pulse), lit, a, pulse);
                var name = names[i];
                var npx = 11 * u;
                var col = i == 2 ? new Color(255, 150, 130) * 0.6f : lit ? HeadGold : Color.White * 0.45f;
                if (i == 2 && lit) col = new Color(255, 150, 130) * 0.6f;
                _ui.TextCentered(_ui.Ui, name, new Vector2(c.X, rowY + 14 * u + 6 * u + npx * 0.6f), npx, col * a, 0, 2 * u / npx);
                x += widths[i];
            }
            y += 28 * u + (L.Compact ? 18 : 22) * u + 10 * u;
            var cap = d.Locked ? $"{T("locked")} · {T("comingSoon")}" : T("stageOf", Math.Max(at, Math.Min(2, p.Best)).ToString());
            var cpx = 14 * u;
            var shake = _footFlash > 0 ? MathF.Sin(_footFlash * 50) * 6 * u * (_footFlash / 0.5f) : 0;
            var ccol = _footFlash > 0 ? new Color(0xff, 0x8a, 0x7a) : d.Locked ? new Color(0xa9, 0xb3, 0xc2) : LabelGold;
            _ui.TextCentered(_ui.Serif, cap, new Vector2(cx + shake, y + cpx * 0.6f), cpx, ccol * a, 0, 4 * u / cpx);
            y += cpx * 1.2f + 10 * u;
        }
        else if (d.Panel is "sound" or "graphics" or "language")
        {
            var parts = new List<(string label, string value, int meter)>();
            if (d.Panel == "sound") foreach (var k in new[] { "master", "music", "sfx" }) parts.Add((T(k), null, S.Get(k)));
            else if (d.Panel == "graphics")
            {
                parts.Add((T("quality"), S.Quality != null ? T(S.Quality) : T("auto"), -1));
                parts.Add((T("shake"), T(S.Shake ? "on" : "off"), -1));
            }
            else parts.Add((null, _data.LanguageNames[S.Lang], -1));
            var bpx = 11 * u;
            var vpx = 16 * u;
            float Width((string label, string value, int meter) p)
            {
                var w = 0f;
                if (p.label != null && !L.Compact) w += _ui.Ui.Measure(p.label, bpx, 2 * u / bpx) + 8 * u;
                w += p.meter >= 0 ? 10 * 5 * u + 9 * 3 * u : _ui.Serif.Measure(p.value, vpx, 2 * u / vpx);
                return w;
            }
            var total = parts.Sum(Width) + (parts.Count - 1) * 26 * u;
            var x = cx - total / 2;
            var my = y + 8 * u;
            foreach (var p in parts)
            {
                if (p.label != null && !L.Compact)
                {
                    _ui.Ui.Draw(_ui.Batch, p.label, new Vector2(x, my - bpx * 0.55f), bpx, Color.White * (0.55f * a), 2 * u / bpx);
                    x += _ui.Ui.Measure(p.label, bpx, 2 * u / bpx) + 8 * u;
                }
                if (p.meter >= 0)
                {
                    DrawMeter(new Vector2(x, my - 5.5f * u), p.meter, 10, 5 * u, 11 * u, 3 * u, a);
                    x += 10 * 5 * u + 9 * 3 * u;
                }
                else
                {
                    _ui.Serif.Draw(_ui.Batch, p.value, new Vector2(x, my - vpx * 0.55f), vpx, HeadGold * a, 2 * u / vpx);
                    x += _ui.Serif.Measure(p.value, vpx, 2 * u / vpx);
                }
                x += 26 * u;
            }
            y += 16 * u + 10 * u;
        }
        if (!d.Locked && !L.Compact)
        {
            var opx = 11 * u;
            var pulse = 0.775f + 0.225f * MathF.Cos(_time * MathF.PI * 2 / 1.6f);
            _ui.TextCentered(_ui.Ui, T("open"), new Vector2(cx, y + opx * 0.6f), opx, Color.White * (0.5f * a * pulse), 0, 3 * u / opx);
        }
    }

    private void DrawNode(Vector2 c, float r, bool lit, float a, float pulse)
    {
        var u = _L.U;
        if (lit)
        {
            _ui.SoftDisc(c, r * (3.2f + pulse * 1.6f), new Color(255, 170, 40) * ((0.5f + 0.3f * pulse) * a));
            _ui.SoftDisc(c, r * 2f, new Color(255, 200, 80) * (0.8f * a));
            _ui.Disc(c, r, GoldHi * a);
            _ui.Disc(c, r - 2 * u, new Color(0xc5, 0x8a, 0x24) * a);
            _ui.Disc(c + new Vector2(-1, -1) * u, r - 3 * u, Gold * a);
            _ui.Disc(c + new Vector2(-2, -2.5f) * u, r * 0.4f, new Color(0xff, 0xfb, 0xe6) * a);
        }
        else
        {
            _ui.Disc(c, r, Color.Black * (0.55f * a));
            _ui.Ring(c, r - u, 2 * u, Color.White * (0.4f * a));
        }
    }

    private void DrawBossNode(Vector2 c, bool lit, float a, float pulse)
    {
        var u = _L.U;
        var size = 22 * u * MathF.Sqrt(0.5f) * 1.41f / 1.41f;
        if (lit) _ui.SoftDisc(c, 26 * u, new Color(255, 80, 60) * (0.8f * a));
        Diamond(c, size, (lit ? new Color(0xff, 0xb0, 0xa0) : new Color(255, 110, 90) * 0.55f) * a);
        Diamond(c, size - 4 * u, (lit ? new Color(0xc8, 0x2a, 0x24) : new Color(30, 6, 6) * 0.75f) * a);
        _ui.TextCentered(_ui.Hud, "☠", c, 15 * u, (lit ? Color.White : Color.White * 0.45f) * a);
    }

    private void Diamond(Vector2 c, float side, Color col) =>
        _ui.Batch.Draw(_ui.White, c, null, col, MathF.PI / 4, new Vector2(0.5f, 0.5f), new Vector2(side, side), SpriteEffects.None, 0);

    /// <summary>Segmented meter: skewed cells, gold when on.</summary>
    private void DrawMeter(Vector2 topLeft, int value, int max, float cw, float ch, float gap, float a)
    {
        var s = ch * SkewTan;
        var key = $"cell{(int)cw}x{(int)ch}";
        if (!_gen.TryGetValue(key + "on", out var onTex))
        {
            onTex = _gen[key + "on"] = Parallelogram((int)MathF.Ceiling(cw + s), (int)MathF.Ceiling(ch), s, (fx, fy) => Grad3(fy, GoldHi, new Color(0xf0, 0xc5, 0x5a), new Color(0xc5, 0x8a, 0x24), 0.5f));
            _gen[key + "off"] = Parallelogram((int)MathF.Ceiling(cw + s), (int)MathF.Ceiling(ch), s, (fx, fy) => new Vector4(0.14f));
        }
        var offTex = _gen[key + "off"];
        for (var i = 0; i < max; i++)
        {
            var p = new Vector2(topLeft.X + i * (cw + gap) - s / 2, topLeft.Y);
            if (i < value) _ui.SoftDisc(p + new Vector2(cw / 2 + s / 2, ch / 2), ch * 0.8f, new Color(255, 200, 80) * (0.25f * a));
            _ui.Batch.Draw(i < value ? onTex : offTex, p, Color.White * a);
        }
    }

    private void DrawPanel(float a, float offset)
    {
        var L = _L;
        var u = L.U;
        var c = L.Compact;
        var pause = _mode == "pause";
        var d = Focused.Def;
        var items = PanelItems();
        _panelIndex = Math.Clamp(_panelIndex, 0, items.Count - 1);
        var glowHex = pause ? 0xffcf6a : d.GlowHex;
        var accent = new Color((glowHex >> 16) & 255, (glowHex >> 8) & 255, glowHex & 255);
        var box = pause ? L.PausePanel : L.Panel;
        var padX = (c ? 18 : 32) * u;
        var padY = (c ? 14 : 26) * u;
        var innerW = box.Width - padX * 2;
        var headPx = (c ? 18 : 26) * u;
        var headH = headPx * 1.15f + (c ? 6 : 12) * u + 2 * u + (c ? 8 : 16) * u;
        // Content height first (the frame is centred on the card).
        var briefPx = (c ? 12 : 15) * u;
        var brief = new List<(string text, List<string> lines)>();
        var h = padY + headH;
        if (_open == "scenario")
        {
            foreach (var key in new[] { "brief1", "brief2", "brief3" })
            {
                var lines = Wrap(_ui.Ui, T(key), briefPx, innerW - 40 * u);
                brief.Add((key, lines));
                h += MathF.Max(26 * u, lines.Count * briefPx * 1.3f) + (c ? 6 : 12) * u;
            }
            h += (c ? 0 : 2) * u;
        }
        var askPx = 21 * u;
        List<string> ask = null;
        if (_open == "exit")
        {
            ask = Wrap(_ui.Serif, _farewell ? T("farewell") : T("quitAsk"), askPx, innerW);
            h += 6 * u + ask.Count * askPx * 1.25f + 16 * u;
        }
        var rowH = (c ? 7 : 12) * u * 2 + (c ? 16 : 22) * u;
        var btnPx = (c ? 15 : 19) * u;
        var btnH = (c ? 8 : 13) * u * 2 + btnPx * 1.2f;
        var btnGap = pause ? 12 * u : (c ? 6 : 10) * u;
        foreach (var it in items) h += it.Kind == "button" ? btnGap + btnH : rowH;
        string note = null;
        var warn = false;
        if (_open == "sound") note = T("soundNote");
        if (_open == "graphics" && (S.Quality ?? RunningQuality) != RunningQuality)
        {
            note = T("qualityNote");
            warn = true;
        }
        var notePx = 12 * u;
        if (note != null) h += 16 * u + notePx * 1.3f;
        h += padY;
        var fr = new RectangleF(box.X + offset, box.Y + MathF.Max(0, (box.Height - h) / 2), box.Width, h);

        // Frame: drop shadow, gradient fill, gold hairline, inset lines, corner brackets.
        SoftBox(new RectangleF(fr.X, fr.Y + 20 * u, fr.Width, fr.Height), 50 * u, Color.Black * (0.55f * a));
        VGrad(fr, new Color(28, 22, 15) * 0.9f, new Color(12, 9, 6) * 0.94f, a);
        Frame(fr, u, Gold * (0.45f * a));
        Frame(new RectangleF(fr.X + 5 * u, fr.Y + 5 * u, fr.Width - 10 * u, fr.Height - 10 * u), u, Gold * (0.22f * a));
        var bl = 34 * u;
        var bt = 3 * u;
        _ui.Rect(new RectangleF(fr.X - 6 * u, fr.Y - 6 * u, bl, bt), Gold * a);
        _ui.Rect(new RectangleF(fr.X - 6 * u, fr.Y - 6 * u, bt, bl), Gold * a);
        _ui.Rect(new RectangleF(fr.Right + 6 * u - bl, fr.Bottom + 6 * u - bt, bl, bt), Gold * a);
        _ui.Rect(new RectangleF(fr.Right + 6 * u - bt, fr.Bottom + 6 * u - bl, bt, bl), Gold * a);
        _hits.Add((fr, () => { }));

        var x = fr.X + padX;
        var y = fr.Y + padY;
        var heading = pause
            ? T(_open switch { "pause" => "paused", "pauseOptions" => "optionsHead", "sound" => "soundTitle", "graphics" => "graphicsTitle", _ => "languageTitle" })
            : _open == "scenario" ? T("briefing") : T(d.Title);
        _ui.Serif.DrawShadowed(_ui.Batch, heading, new Vector2(x, y), headPx, HeadGold * a, new Color(0x1a, 0x10, 0x04) * a, new Vector2(0, 2 * u), 5 * u / headPx);
        y += headPx * 1.15f + (c ? 6 : 12) * u;
        _ui.Batch.Draw(_hGrad, new Vector2(x, y), null, accent * a, 0, Vector2.Zero, new Vector2(innerW / 256f, 2 * u), SpriteEffects.None, 0);
        y += 2 * u + (c ? 8 : 16) * u;

        if (_open == "scenario")
        {
            var p = _store.Progress(d.Id);
            for (var i = 0; i < brief.Count; i++)
            {
                var lines = brief[i].lines;
                var bh = MathF.Max(26 * u, lines.Count * briefPx * 1.3f);
                var cc = new Vector2(x + 13 * u, y + bh / 2);
                var lit = i < p.Best;
                if (lit && i < 2)
                {
                    _ui.SoftDisc(cc, 24 * u, new Color(255, 200, 80) * (0.6f * a));
                    _ui.Disc(cc, 13 * u, GoldHi * a);
                    _ui.Disc(cc, 11 * u, Gold * a);
                }
                else _ui.Ring(cc, 12 * u, 2 * u, (i == 2 ? new Color(255, 110, 90) * 0.6f : Color.White * 0.3f) * a);
                var glyph = i == 2 ? "☠" : (i + 1).ToString();
                var gcol = i == 2 ? new Color(255, 150, 130) * 0.8f : lit ? new Color(0x2a, 0x16, 0x06) : Color.White * 0.6f;
                _ui.TextCentered(i == 2 ? _ui.Hud : _ui.Serif, glyph, cc, 13 * u, gcol * a);
                var ty = y + (bh - lines.Count * briefPx * 1.3f) / 2 + briefPx * 0.15f;
                foreach (var line in lines)
                {
                    _ui.Ui.Draw(_ui.Batch, line, new Vector2(x + 40 * u, ty), briefPx, Color.White * (0.72f * a));
                    ty += briefPx * 1.3f;
                }
                y += bh + (c ? 6 : 12) * u;
            }
            y += (c ? 0 : 2) * u;
        }
        if (ask != null)
        {
            y += 6 * u;
            foreach (var line in ask)
            {
                _ui.TextCentered(_ui.Serif, line, new Vector2(fr.Center.X, y + askPx * 0.6f), askPx, Cream * a);
                y += askPx * 1.25f;
            }
            y += 16 * u;
        }

        var labelPx = (c ? 13 : 17) * u;
        for (var i = 0; i < items.Count; i++)
        {
            var it = items[i];
            var on = i == _panelIndex;
            var idx = i;
            if (it.Kind == "button")
            {
                y += btnGap;
                var br = new RectangleF(x, y, innerW, btnH);
                var lc = on ? Color.White : Color.White * 0.8f;
                if (it.Primary || it.Danger)
                {
                    var top = it.Primary ? new Color(0xff, 0xe0, 0x7a) : new Color(0xe8, 0x48, 0x3a);
                    var bot = it.Primary ? new Color(0xe0, 0x98, 0x1e) : new Color(0x8e, 0x12, 0x18);
                    var op = on ? 1 : 0.8f;
                    if (on) SoftBox(br, 22 * u, (it.Primary ? new Color(255, 200, 80) : new Color(255, 80, 60)) * (0.55f * a));
                    VGrad(br, top * op, bot * op, a);
                    Frame(br, 2 * u, (on ? (it.Primary ? GoldHi : new Color(0xff, 0xd0, 0xc0)) : (it.Primary ? GoldHi * 0.6f : new Color(255, 170, 150) * 0.5f)) * a);
                    lc = it.Primary ? new Color(0x2a, 0x16, 0x06) : Color.White;
                }
                else
                {
                    _ui.Rect(br, Color.Black * (0.35f * a));
                    if (on) _ui.Batch.Draw(_hGrad, br.ToVector(), null, Gold * (0.24f * a), 0, Vector2.Zero, new Vector2(br.Width / 256f, br.Height), SpriteEffects.None, 0);
                    Frame(br, 2 * u, (on ? Gold : Gold * 0.32f) * a);
                    if (on) _ui.Rect(new RectangleF(br.X, br.Y, 4 * u, br.Height), Gold * a);
                }
                _ui.TextCentered(_ui.Hud, it.Label, br.Center, btnPx, lc * a, 0, 3 * u / btnPx);
                _hits.Add((br, () => ActivatePanel(idx)));
                y += btnH;
                continue;
            }
            var rr = new RectangleF(x - 16 * u, y, innerW + 32 * u, rowH);
            if (on)
            {
                _ui.Batch.Draw(_hGrad, rr.ToVector(), null, Gold * (0.24f * a), 0, Vector2.Zero, new Vector2(rr.Width / 256f, rr.Height), SpriteEffects.None, 0);
                _ui.Rect(new RectangleF(rr.X, rr.Y, 4 * u, rr.Height), Gold * a);
            }
            var cy = rr.Center.Y;
            var lcol = (on ? Color.White : Color.White * 0.72f) * a;
            if (it.Kind == "radio")
            {
                var dc = new Vector2(x + 8 * u, cy);
                if (it.On)
                {
                    _ui.SoftDisc(dc, 16 * u, new Color(255, 200, 80) * (0.6f * a));
                    _ui.Disc(dc, 3.5f * u, GoldHi * a);
                    _ui.Ring(dc, 5 * u, 2.5f * u, Gold * a);
                }
                _ui.Ring(dc, 7 * u, 2 * u, (it.On ? Gold : Gold * 0.6f) * a);
                _ui.Hud.Draw(_ui.Batch, it.Label, new Vector2(x + 32 * u, cy - labelPx * 0.55f), labelPx, lcol, 2 * u / labelPx);
                _hits.Add((rr, () => ActivatePanel(idx)));
                y += rowH;
                continue;
            }
            // Control (right aligned): ◀ value ▶
            var apx = 14 * u;
            var gap = (c ? 6 : 10) * u;
            var aw = _ui.Ui.Measure("▶", apx) + 8 * u;
            var vpx = (c ? 13 : 16) * u;
            float valueW;
            var cellW = (c ? 7 : 12) * u;
            var cellH = (c ? 13 : 18) * u;
            if (it.Kind == "slider") valueW = it.Max * cellW + (it.Max - 1) * 3 * u + gap + (c ? 34 : 46) * u;
            else valueW = (c ? 110 : 150) * u;
            var rx = x + innerW;
            var ra = new RectangleF(rx - aw, cy - aw / 2, aw, aw);
            var vx = ra.X - gap - valueW;
            var la = new RectangleF(vx - gap - aw, cy - aw / 2, aw, aw);
            // Label: shrinks to fit left of the control.
            var lpx = labelPx;
            var room = la.X - x - 8 * u;
            var lw = _ui.Hud.Measure(it.Label, lpx, 2 * u / lpx);
            if (lw > room && room > 0) lpx *= room / lw;
            _ui.Hud.Draw(_ui.Batch, it.Label, new Vector2(x, cy - lpx * 0.55f), lpx, lcol, 2 * u / lpx);
            var acol = Gold * ((on ? 1 : 0.55f) * a);
            _ui.TextCentered(_ui.Ui, "◀", la.Center, apx, acol);
            _ui.TextCentered(_ui.Ui, "▶", ra.Center, apx, acol);
            if (it.Kind == "slider")
            {
                DrawMeter(new Vector2(vx, cy - cellH / 2), it.Value, it.Max, cellW, cellH, 3 * u, a);
                var txt = $"{it.Value * 10}%";
                var tw = _ui.Serif.Measure(txt, vpx);
                _ui.Serif.Draw(_ui.Batch, txt, new Vector2(vx + valueW - tw, cy - vpx * 0.55f), vpx, HeadGold * a);
            }
            else _ui.TextCentered(_ui.Serif, it.Text, new Vector2(vx + valueW / 2, cy), vpx, HeadGold * a);
            _hits.Add((rr, () => { _panelIndex = idx; Adjust(PanelItems()[idx], 1); }));
            _hits.Add((Grow(la, 6 * u), () => { _panelIndex = idx; Adjust(PanelItems()[idx], -1); }));
            _hits.Add((Grow(ra, 6 * u), () => { _panelIndex = idx; Adjust(PanelItems()[idx], 1); }));
            y += rowH;
        }
        if (note != null)
        {
            y += 16 * u;
            _ui.Ui.Draw(_ui.Batch, note, new Vector2(x, y), notePx, (warn ? new Color(0xff, 0xb0, 0x50) : Color.White * 0.5f) * a, u / notePx);
        }
    }

    private static RectangleF Grow(RectangleF r, float d) => new(r.X - d, r.Y - d, r.Width + 2 * d, r.Height + 2 * d);

    private static List<string> Wrap(BitmapFont font, string text, float px, float maxW)
    {
        var lines = new List<string>();
        var cur = "";
        foreach (var word in text.Split(' '))
        {
            var next = cur.Length == 0 ? word : cur + " " + word;
            if (cur.Length > 0 && font.Measure(next, px) > maxW)
            {
                lines.Add(cur);
                cur = word;
            }
            else cur = next;
        }
        if (cur.Length > 0) lines.Add(cur);
        return lines;
    }

    // ---- Drawing helpers -----------------------------------------------------------------------

    private void Frame(RectangleF r, float t, Color c)
    {
        _ui.Rect(new RectangleF(r.X, r.Y, r.Width, t), c);
        _ui.Rect(new RectangleF(r.X, r.Bottom - t, r.Width, t), c);
        _ui.Rect(new RectangleF(r.X, r.Y + t, t, r.Height - 2 * t), c);
        _ui.Rect(new RectangleF(r.Right - t, r.Y + t, t, r.Height - 2 * t), c);
    }

    private void VGrad(RectangleF r, Color top, Color bottom, float a)
    {
        var tex = _gen.TryGetValue("vgrad", out var t) ? t : _gen["vgrad"] = Gen(1, 64, (_, y) => new Vector4(1 - y / 63f));
        _ui.Rect(r, bottom * a);
        _ui.Batch.Draw(tex, r.ToVector(), null, top * a, 0, Vector2.Zero, new Vector2(r.Width, r.Height / 64f), SpriteEffects.None, 0);
    }

    /// <summary>Blurred box (CSS box-shadow): 9-slice of the soft texture, `blur` pixels of falloff.</summary>
    private void SoftBox(RectangleF r, float blur, Color c)
    {
        var o = new RectangleF(r.X - blur, r.Y - blur, r.Width + 2 * blur, r.Height + 2 * blur);
        const int e = 24;
        float[] xs = { o.X, o.X + blur * 2, o.Right - blur * 2, o.Right };
        float[] ys = { o.Y, o.Y + blur * 2, o.Bottom - blur * 2, o.Bottom };
        if (xs[2] < xs[1]) xs[1] = xs[2] = o.Center.X;
        if (ys[2] < ys[1]) ys[1] = ys[2] = o.Center.Y;
        int[] sx = { 0, e, 64 - e, 64 };
        for (var j = 0; j < 3; j++)
        for (var i = 0; i < 3; i++)
        {
            var w = xs[i + 1] - xs[i];
            var h = ys[j + 1] - ys[j];
            if (w <= 0 || h <= 0) continue;
            var src = new Rectangle(sx[i], sx[j], sx[i + 1] - sx[i], sx[j + 1] - sx[j]);
            _ui.Batch.Draw(_soft, new Vector2(xs[i], ys[j]), src, c, 0, Vector2.Zero, new Vector2(w / src.Width, h / src.Height), SpriteEffects.None, 0);
        }
    }

    /// <summary>Plate textures at the current plate size (regenerated when the layout changes).</summary>
    private void EnsureTextures()
    {
        var L = _L;
        var key = $"{(int)L.NavW}x{(int)L.PlateH}x{L.U:0.000}";
        if (key == _genKey) return;
        _genKey = key;
        foreach (var t in _gen.Values) t.Dispose();
        _gen.Clear();
        var u = L.U;
        var w = (int)MathF.Ceiling(L.NavW);
        var h = (int)MathF.Ceiling(L.PlateH);
        var s = h * SkewTan;
        var tw = (int)MathF.Ceiling(w + s);
        Vector4 PlateFill(float fy, Color top, float topA, Color bottom, float bottomA, float bt, Color bc, float bb, Color bbc)
        {
            var y = fy * h;
            if (y < bt) return bc.ToVector4();
            if (y > h - bb) return bbc.ToVector4();
            var c = Vector4.Lerp(top.ToVector4() * topA, bottom.ToVector4() * bottomA, fy);
            return c;
        }
        _gen["plate"] = Parallelogram(tw, h, s, (fx, fy) => PlateFill(fy, new Color(34, 29, 24), 0.82f, new Color(14, 12, 10), 0.86f, 1, new Color(68, 60, 50) * 0.84f, 1, Color.Black * 0.6f));
        _gen["plateOn"] = Parallelogram(tw, h, s, (fx, fy) => PlateFill(fy, new Color(86, 60, 22), 0.94f, new Color(32, 22, 9), 0.94f, 2 * u, Gold, 2 * u, GoldLo));
        var bw = (int)MathF.Ceiling(8 * u + s);
        _gen["bar"] = Parallelogram(bw, h, s, (fx, fy) => new Vector4(0.14f));
        _gen["barOn"] = Parallelogram(bw, h, s, (fx, fy) => Grad3(fy, GoldHi, new Color(0xf0, 0xc5, 0x5a), GoldLo, 0.45f));
    }

    private static Vector4 Grad3(float t, Color a, Color b, Color c, float mid) =>
        t < mid ? Vector4.Lerp(a.ToVector4(), b.ToVector4(), t / mid) : Vector4.Lerp(b.ToVector4(), c.ToVector4(), (t - mid) / (1 - mid));

    /// <summary>
    /// Parallelogram (CSS skewX(-14deg): top edge shifted right by `skew`) with anti-aliased edges,
    /// filled with premultiplied colour fill(xFraction, yFraction).
    /// </summary>
    private Texture2D Parallelogram(int w, int h, float skew, Func<float, float, Vector4> fill)
    {
        w = Math.Max(1, w);
        h = Math.Max(1, h);
        var inner = w - skew;
        return Gen(w, h, (x, y) =>
        {
            var py = y + 0.5f;
            var left = skew * (1 - py / h);
            var px = x + 0.5f;
            var cov = MathHelper.Clamp(px - left + 0.5f, 0, 1) * MathHelper.Clamp(left + inner - px + 0.5f, 0, 1);
            if (cov <= 0) return Vector4.Zero;
            var c = fill((px - left) / inner, py / h);
            if (c.W > 0 && c.X <= c.W + 1e-3f && c.Y <= c.W + 1e-3f && c.Z <= c.W + 1e-3f)
                return c * cov; // already premultiplied
            return new Vector4(c.X * c.W, c.Y * c.W, c.Z * c.W, c.W) * cov;
        });
    }

    private Texture2D Gen(int w, int h, Func<int, int, Vector4> f)
    {
        var data = new Color[w * h];
        for (var y = 0; y < h; y++)
        for (var x = 0; x < w; x++)
            data[y * w + x] = new Color(f(x, y));
        var t = new Texture2D(_device, w, h, false, SurfaceFormat.Color);
        t.SetData(data);
        return t;
    }

    public void Dispose()
    {
        foreach (var t in _gen.Values) t.Dispose();
        _soft.Dispose();
        _hGrad.Dispose();
        _shade.Dispose();
    }
}
