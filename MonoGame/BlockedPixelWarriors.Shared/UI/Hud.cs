using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Gameplay;
using BlockedPixelWarriors.Input;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.UI;

public enum Overlay { None, Title, GameOver, Pause, Won }

/// <summary>
/// Heads-up display (port of Hud.js + hud.css): score / wave panels, the train damage panel,
/// segmented HP bar, lives, toasts that fly into the terminal-style kill feed, notices, active
/// power-up feed, damage vignette and the title / game-over / pause overlays. Sizes are the web
/// CSS pixels times <see cref="UiKit.Scale"/>.
/// </summary>
public sealed class Hud : IHudEvents
{
    private sealed class LogLine
    {
        public (string text, Color color)[] Parts;
        public bool Event;
        public float Age, Ttl = 9, Wait;
    }

    private sealed class FloatingText
    {
        public string Text;
        public Vector3 World;
        public Color Color;
        public float Age, Drift;
    }

    private readonly UiKit _ui;
    private readonly Texture2D _logo;
    private readonly List<LogLine> _log = new();
    private readonly List<FloatingText> _floats = new();
    private (string text, Color color, float age)? _toast;
    private (string text, float age, Vector2 from, LogLine line)? _ghost;
    private (string text, Color color, float age)? _notice;
    private float _vignette;
    private float _overlayAlpha;
    private float _time;
    private readonly Dictionary<SupplyType, float> _skillAge = new();
    private int _finalScore;
    private int[] _delivered = new int[3];

    public Overlay Overlay { get; private set; } = Overlay.Title;
    /// <summary>Pause menu buttons (screen rects, valid after Draw).</summary>
    public RectangleF ResumeButton { get; private set; }
    public RectangleF RestartButton { get; private set; }
    public RectangleF QuitButton { get; private set; }
    public RectangleF MainMenuButton { get; private set; }
    /// <summary>CONTINUE (stage-2 checkpoint) on the title / game-over screens, when a save exists.</summary>
    public RectangleF ContinueButton { get; private set; }
    public bool ContinueAvailable { get; set; }
    public bool ShowQuit { get; set; }
    /// <summary>Title help text for touch screens.</summary>
    public bool TouchHelp { get; set; }
    /// <summary>While the upgrade cards are up, toasts and notices stay out of the way.</summary>
    public bool CardsOpen { get; set; }
    private float _cardsFade = 1;

    public Hud(UiKit ui, Texture2D logo)
    {
        _ui = ui;
        _logo = logo;
    }

    // ---- IHudEvents ---------------------------------------------------------------------------

    public void Toast(string text, Color? color = null)
    {
        if (_toast.HasValue) ToLog(_toast.Value.text, _toast.Value.color, false);
        _toast = (text, color ?? FeedColors.ToastDefault, 0);
    }

    public void Notice(string text, Color color) => _notice = (text, color, 0);

    public void Kill(string who, Color whoColor, string what, Color whatColor, string extra = null, Color? extraColor = null)
    {
        var parts = new List<(string, Color)> { (who, whoColor), ("  ➜  ", Color.White * 0.55f), (what, whatColor) };
        if (extra != null) parts.Add(($"  {extra}", extraColor ?? Color.White));
        AddLine(parts.ToArray(), false);
    }

    public void DamageFlash(float strength) => _vignette = MathF.Max(_vignette, MathF.Min(1, strength));

    public void FloatText(string text, Vector3 world, Color color)
    {
        if (_floats.Count > 12) return;
        _floats.Add(new FloatingText { Text = text, World = world, Color = color, Drift = (Rng.Shared.Next() - 0.5f) * 30 });
    }

    public void ShowTitle() => Overlay = Overlay.Title;

    /// <summary>True while the main menu is up: the HUD stays hidden (the attract game plays behind).</summary>
    public bool MenuMode { get; set; }

    /// <summary>Empties the log feed and any toast (new run).</summary>
    public void ClearLog()
    {
        _log.Clear();
        _toast = null;
    }

    public void ShowGameOver(int score)
    {
        _finalScore = score;
        Overlay = Overlay.GameOver;
    }

    public void ShowMissionComplete(int score, IReadOnlyList<int> delivered)
    {
        _finalScore = score;
        _delivered = delivered.ToArray();
        Overlay = Overlay.Won;
    }

    public void ShowPause() => Overlay = Overlay.Pause;

    public void HideOverlay() => Overlay = Overlay.None;

    private LogLine AddLine((string, Color)[] parts, bool isEvent)
    {
        var line = new LogLine { Parts = parts, Event = isEvent };
        _log.Add(line);
        while (_log.Count > 6) _log.RemoveAt(0);
        return line;
    }

    /// <summary>A toast moves into the log; with fly, a ghost copy shrinks onto its line.</summary>
    private void ToLog(string text, Color color, bool fly)
    {
        var line = AddLine(new[] { (text, color) }, true);
        if (fly)
        {
            line.Wait = 0.5f;
            _ghost = (text, 0, Vector2.Zero, line);
        }
    }

    // ---- Update / draw ------------------------------------------------------------------------

    public void Update(float dt, IReadOnlyList<ActivePower> powers)
    {
        _time += dt;
        _cardsFade = MathHelper.Clamp(_cardsFade + (CardsOpen ? -dt : dt) / 0.2f, 0, 1);
        foreach (var key in _skillAge.Keys.ToList())
            if (!powers.Any(p => p.Type == key)) _skillAge.Remove(key);
        foreach (var p in powers)
        {
            _skillAge.TryGetValue(p.Type, out var age);
            _skillAge[p.Type] = age + dt;
        }
        if (_toast.HasValue)
        {
            var t = _toast.Value;
            t.age += dt;
            if (t.age >= 2.2f)
            {
                _toast = null;
                ToLog(t.text, t.color, true);
            }
            else
            {
                _toast = t;
            }
        }
        if (_ghost.HasValue)
        {
            var g = _ghost.Value;
            g.age += dt;
            if (g.age >= 0.52f)
            {
                g.line.Wait = 0;
                _ghost = null;
            }
            else
            {
                _ghost = g;
            }
        }
        if (_notice.HasValue)
        {
            var n = _notice.Value;
            n.age += dt;
            _notice = n.age > 1.2f ? null : n;
        }
        foreach (var l in _log)
        {
            l.Age += dt;
            if (l.Wait > 0) l.Wait -= dt;
        }
        _log.RemoveAll(l => l.Age > l.Ttl + 0.7f);
        _vignette = MathF.Max(0, _vignette - dt / 2);
        foreach (var f in _floats) f.Age += dt;
        _floats.RemoveAll(f => f.Age > 0.9f);
        var target = Overlay == Overlay.None ? 0 : 1;
        _overlayAlpha += (target - _overlayAlpha) * MathX.Damp(Overlay == Overlay.Pause ? 14 : 6, dt);
    }

    private static readonly Color PanelFill = Color.FromNonPremultiplied(14, 20, 30, 107);
    private static readonly Color Dark = new(0x1b, 0x1d, 0x21);

    public void Draw(Rectangle vp, GameSession s, Camera3D camera, TouchControls touch, bool showTouch)
    {
        var k = _ui.Scale;
        _ui.Begin();
        if (_vignette > 0.001f) _ui.DamageVignette(vp, _vignette);
        if (MenuMode)
        {
            _ui.End();
            return;
        }
        var playing = s.State is GameState.Playing or GameState.Dead;
        var hudAlpha = 1 - _overlayAlpha * (Overlay == Overlay.Pause ? 0.4f : 1);
        if (hudAlpha > 0.01f && Overlay != Overlay.Title)
        {
            DrawTop(vp, s, k, hudAlpha);
            // HP, mission, chopper countdown and the log sit bottom left on every device.
            DrawBottomLeft(vp, s, k, hudAlpha, null);
            DrawSkills(vp, s, k, hudAlpha, showTouch);
        }
        if (!s.Paused) DrawNoticeAndToast(vp, k);
        if (!s.Paused && s.TrainWarnPoint is { } warn) DrawTrainWarning(vp, camera, warn, s.TrainWarnSide == "top", k);
        DrawFloats(vp, camera, k);
        if (showTouch && playing && Overlay == Overlay.None && !s.Paused) DrawTouch(touch, k);
        if (_overlayAlpha > 0.01f) DrawOverlay(vp, k);
        _ui.End();
    }

    private RectangleF DrawTop(Rectangle vp, GameSession s, float k, float alpha)
    {
        var pad = new Vector2(16 * k, 12 * k);
        var valuePx = Math.Clamp(vp.Width * 0.032f / k, 18, 30) * k;
        RectangleF Panel(string label, string value, float x, bool right)
        {
            var lw = _ui.Hud.Measure(label, 11 * k, 0.18f);
            var vw = _ui.Hud.Measure(value, valuePx);
            var w = MathF.Max(lw, vw) + 28 * k + 4 * k;
            var h = 6 * k + 13 * k + valuePx * 1.15f + 6 * k + 4 * k;
            var r = new RectangleF(right ? x - w : x, pad.Y, w, h);
            _ui.Panel(r, 10 * k, Color.FromNonPremultiplied(20, 28, 40, 115) * alpha);
            _ui.Outline(r, 10 * k, Color.White * 0.35f * alpha);
            _ui.Text(_ui.Hud, label, new Vector2(r.X + 16 * k, r.Y + 8 * k), 11 * k, Color.White * 0.8f * alpha, 0, 0.18f);
            _ui.Text(_ui.Hud, value, new Vector2(r.X + 16 * k, r.Y + 8 * k + 14 * k), valuePx, Color.White * alpha, 3 * k);
            return r;
        }
        var score = Panel("SCORE", s.ScoreValue.ToString("000000"), vp.X + pad.X, false);
        var wave = Panel("WAVE", Math.Max(1, s.Wave).ToString(), vp.Right - pad.X, true);
        DrawTrainPanel(vp, s.Train, k, alpha, score.Right + 12 * k, wave.X - 12 * k);
        return score;
    }

    /// <summary>Train damage panel: one card per car, one tick per destructible part.</summary>
    private void DrawTrainPanel(Rectangle vp, Train train, float k, float alpha, float left, float right)
    {
        if (train == null || train.Finished) return;
        var tickW = vp.Width / k < 700 ? 4 * k : 6 * k;
        var tickH = vp.Width / k < 700 ? 11 * k : 14 * k;
        var headPx = (vp.Width / k < 700 ? 8 : 9) * k;
        var maxW = MathF.Min(MathF.Min(560 * k, vp.Width * 0.62f), right - left);
        // Lay cars out in rows (flex-wrap, centred).
        var cars = new List<(TrainCar car, float w)>();
        foreach (var car in train.Cars)
        {
            float w = 3 * k * 2 + 1.5f * k * 2;
            var n = 0;
            foreach (var t in car.Targets)
            {
                if (t.Kind == TargetKind.Hull) continue;
                w += (t.Kind == TargetKind.Gem ? tickW * 2 : tickW) + (n++ > 0 ? 2 * k : 0);
            }
            cars.Add((car, w));
        }
        var rows = new List<List<(TrainCar car, float w)>> { new() };
        float rowW = 0;
        foreach (var c in cars)
        {
            if (rowW > 0 && rowW + 5 * k + c.w > maxW - 16 * k)
            {
                rows.Add(new List<(TrainCar, float)>());
                rowW = 0;
            }
            rows[^1].Add(c);
            rowW += (rowW > 0 ? 5 * k : 0) + c.w;
        }
        var carH = tickH + 6 * k + 3 * k;
        var contentW = rows.Max(r => r.Sum(c => c.w) + 5 * k * (r.Count - 1));
        var lap = train.Lap;
        var mode = train.Stopped ? "HALT" : train.Mode;
        var shield = train.GemShielded ? " · SHIELD" : "";
        var pct = train.Destroyed ? "DESTROYED" : $"{(lap > 1 ? $"LAP {lap} · " : "")}{mode}{shield} · {MathF.Round(train.Integrity * 100)}%";
        var title = train.Title;
        var headW = _ui.Hud.Measure(title, headPx, 0.22f) + 14 * k + _ui.Hud.Measure(pct, headPx, 0.22f);
        var panelW = MathF.Max(contentW, headW) + 16 * k;
        var panelH = 5 * k + headPx * 1.2f + 4 * k + rows.Count * carH + (rows.Count - 1) * 5 * k + 7 * k;
        var cx = (left + right) / 2;
        var r = new RectangleF(cx - panelW / 2, 12 * k, panelW, panelH);
        _ui.Panel(r, 8 * k, PanelFill * alpha);
        _ui.Text(_ui.Hud, title, new Vector2(r.X + 8 * k, r.Y + 5 * k), headPx, Color.White * 0.85f * alpha, 0, 0.22f);
        var pctColor = train.Destroyed ? new Color(0xff, 0xcf, 0x2d) : Color.White * 0.85f;
        _ui.Text(_ui.Hud, pct, new Vector2(r.Right - 8 * k - _ui.Hud.Measure(pct, headPx, 0.22f), r.Y + 5 * k), headPx, pctColor * alpha, 0, 0.22f);
        var y = r.Y + 5 * k + headPx * 1.2f + 4 * k;
        var first = true;
        foreach (var row in rows)
        {
            var rw = row.Sum(c => c.w) + 5 * k * (row.Count - 1);
            var x = cx - rw / 2;
            foreach (var (car, w) in row)
            {
                var carAlive = false;
                foreach (var t in car.Targets) if (t.Kind != TargetKind.Hull && t.Alive) carAlive = true;
                var a = (!carAlive || train.Destroyed ? 0.35f : 1) * alpha;
                var cr = new RectangleF(x, y, w, carH);
                _ui.Outline(cr, 3 * k, (first ? new Color(0xff, 0x5a, 0x64) : Color.White * 0.75f) * a);
                var tx = x + 3 * k + 1.5f * k;
                foreach (var t in car.Targets)
                {
                    if (t.Kind == TargetKind.Hull) continue;
                    var tw = t.Kind == TargetKind.Gem ? tickW * 2 : tickW;
                    var tr = new RectangleF(tx, y + 3 * k + 1.5f * k, tw, tickH);
                    if (t.Alive)
                    {
                        _ui.Rect(tr, Color.White * 0.12f * a);
                        var ratio = Math.Clamp(t.Hp / t.MaxHp, 0, 1);
                        var col = t.Kind switch
                        {
                            TargetKind.Gem => new Color(0xff, 0x2a, 0x3a),
                            TargetKind.Turret => new Color(0xb8, 0xbe, 0xc8),
                            TargetKind.Crane => new Color(0xf0, 0xb2, 0x1c),
                            _ => Palette.Block(t.Color),
                        };
                        if (ratio < 1) col = Color.Lerp(col, Color.White, 0.2f);
                        _ui.Rect(new RectangleF(tr.X, tr.Bottom - tr.Height * ratio, tr.Width, tr.Height * ratio), col * a);
                    }
                    else
                    {
                        _ui.Outline(tr, 1, Color.White * 0.35f * a);
                    }
                    tx += tw + 2 * k;
                }
                if (!carAlive || train.Destroyed)
                {
                    var c = cr.Center;
                    var d = new Vector2(MathF.Cos(-0.314f), MathF.Sin(-0.314f)) * (cr.Width / 2 + 2 * k);
                    _ui.Line(c - d, c + d, 1.5f * k, Color.White * alpha);
                }
                x += w + 5 * k;
                first = false;
            }
            y += carH + 5 * k;
        }
    }

    private void DrawBottomLeft(Rectangle vp, GameSession s, float k, float alpha, float? topAnchor)
    {
        var x = vp.X + 16 * k;
        var bottom = vp.Bottom - 14 * k;
        // HP row: lives (hearts) + 20-segment bar + number.
        var segW = Math.Clamp(vp.Width * 0.0125f, 7 * k, 12 * k);
        var segH = 12 * k;
        var barW = 20 * segW + 19 * 2 * k + 4 * k + 3 * k;
        var numPx = 12 * k;
        var rowH = segH + 4 * k + 3 * k + 12 * k;
        var heartsW = Math.Max(0, s.Lives) * 22 * k;
        var hpRect = new RectangleF(x + heartsW + (heartsW > 0 ? 12 * k : 0), topAnchor ?? bottom - rowH, 10 * k + barW + 8 * k + MathF.Max(48 * k, _ui.Hud.Measure("100/100", numPx, 0.17f)) + 10 * k, rowH);
        for (var i = 0; i < s.Lives; i++)
        {
            var c = new Vector2(x + 9 * k + i * 22 * k, hpRect.Center.Y);
            DrawHeart(c, 9 * k, alpha);
        }
        _ui.Panel(hpRect, 8 * k, PanelFill * alpha);
        var bar = new RectangleF(hpRect.X + 10 * k, hpRect.Center.Y - (segH + 7 * k) / 2, barW, segH + 7 * k);
        _ui.Outline(bar, 3 * k, Color.White * 0.9f * alpha);
        var ratio = Math.Clamp(s.HealthRatio, 0, 1);
        var lit = (int)MathF.Ceiling(ratio * 20 - 1e-6f);
        var low = ratio < 0.25f;
        var pulse = low ? 0.725f + 0.275f * MathF.Cos(_time * MathF.PI / 0.6f) : 1;
        for (var i = 0; i < 20; i++)
        {
            var sr = new RectangleF(bar.X + 3.5f * k + i * (segW + 2 * k), bar.Y + 3.5f * k, segW, segH);
            var on = i < lit;
            var col = on ? (low ? new Color(0xff, 0x4d, 0x4d) * pulse : new Color(0x6e, 0xe0, 0x5a)) : Color.White * 0.12f;
            _ui.Rect(sr, col * alpha);
        }
        var num = $"{MathF.Round(ratio * 100)}/100";
        _ui.Text(_ui.Hud, num, new Vector2(bar.Right + 8 * k, hpRect.Center.Y - numPx * 0.55f), numPx, Color.White * 0.9f * alpha, 0, 0.17f);

        // Mission + chopper countdown next to the HP row (above it; below it on phones).
        var top = topAnchor.HasValue;
        var anchorTop = hpRect.Y;
        var anchorBottom = hpRect.Bottom;
        var L = s.Logistics;
        if (L.Enabled)
        {
            var narrow = vp.Width / k < 700;
            if (L.CountdownActive)
            {
                var h = (narrow ? 22 : 28) * k;
                var r = DrawChopper(new Vector2(x, top ? anchorBottom + 6 * k : anchorTop - 6 * k - h), h, s, k, alpha, narrow);
                if (top) anchorBottom = r.Bottom; else anchorTop = r.Y;
            }
            {
                var h = (narrow ? 20 : 24) * k;
                var r = DrawMission(new Vector2(x, top ? anchorBottom + 6 * k : anchorTop - 6 * k - h), h, L, k, alpha, narrow);
                if (top) anchorBottom = r.Bottom; else anchorTop = r.Y;
            }
        }

        // Objective checklist (always there): above the mission / chopper bars.
        {
            var (title, items) = s.Objectives();
            var h = DrawObjectives(new Vector2(x, 0), title, items, k, alpha, true).Height;
            var r = DrawObjectives(new Vector2(x, top ? anchorBottom + 6 * k : anchorTop - 6 * k - h), title, items, k, alpha, false);
            if (top) anchorBottom = r.Bottom; else anchorTop = r.Y;
        }

        // Kill feed / terminal log above the HP row.
        var px = (vp.Width / k < 700 ? 10 : 11.5f) * k;
        var lh = px * 1.25f + 6 * k;
        // Bottom layout: newest line right above the HP row; top layout: right below it.
        var lineY = top ? anchorBottom + 6 * k - lh : anchorTop - 6 * k;
        for (var i = _log.Count - 1; i >= 0; i--)
        {
            var l = _log[i];
            lineY += top ? lh : -lh;
            var fade = l.Age > l.Ttl ? 1 - (l.Age - l.Ttl) / 0.7f : 1;
            var slideIn = MathF.Min(1, l.Age / 0.25f);
            var a = alpha * fade * slideIn * (l.Wait > 0 ? 0 : 1);
            var offX = (1 - slideIn) * -14 * k + (l.Age > l.Ttl ? (l.Age - l.Ttl) / 0.7f * -12 * k : 0);
            var prompt = l.Event ? "$" : "›";
            var accent = l.Event ? new Color(0xff, 0xcf, 0x6a) : new Color(0x6e, 0xe0, 0x5a);
            var textW = 0f;
            foreach (var (t, _) in l.Parts) textW += _ui.Mono.Measure(t, px, 0.035f);
            var last = i == _log.Count - 1;
            var caret = last && (int)(_time * 2) % 2 == 0 ? "_" : "";
            var w = 7 * k + _ui.Mono.Measure(prompt, px) + 7 * k + textW + (last ? _ui.Mono.Measure("_", px) + 2 * k : 0) + 9 * k;
            var r = new RectangleF(x + offX, lineY, w, lh - 3 * k);
            _ui.Panel(r, 4 * k, Color.FromNonPremultiplied(8, 12, 18, last ? 184 : 148) * a);
            _ui.Rect(new RectangleF(r.X, r.Y, 2 * k, r.Height), accent * 0.85f * a);
            var tx = r.X + 7 * k;
            var ty = r.Y + (r.Height - px) / 2;
            _ui.Text(_ui.Mono, prompt, new Vector2(tx, ty), px, accent * a);
            tx += _ui.Mono.Measure(prompt, px) + 7 * k;
            foreach (var (t, c) in l.Parts)
            {
                _ui.Mono.DrawShadowed(_ui.Batch, t, new Vector2(tx, ty), px, c * a, Color.Black * 0.8f * a, new Vector2(0, k), 0.035f);
                tx += _ui.Mono.Measure(t, px, 0.035f);
            }
            if (caret.Length > 0) _ui.Text(_ui.Mono, caret, new Vector2(tx + 2 * k, ty), px, new Color(0x6e, 0xe0, 0x5a) * a);
        }
        if (_ghost.HasValue && _ghost.Value.line != null)
        {
            // Toast ghost flying into its log line (0.5 s ease).
            var g = _ghost.Value;
            var t = MathX.SmoothStep(0, 1, g.age / 0.5f);
            var toastPx = Math.Clamp(vp.Width * 0.03f / k, 16, 28) * k;
            var from = new Vector2(vp.Center.X - _ui.Hud.Measure(g.text, toastPx) / 2, vp.Y + vp.Height * 0.18f);
            var idx = _log.IndexOf(g.line);
            var to = top
                ? new Vector2(x + 7 * k + 12 * k, anchorBottom + 6 * k + (_log.Count - 1 - idx) * lh + 3 * k)
                : new Vector2(x + 7 * k + 12 * k, anchorTop - 6 * k - (_log.Count - idx) * lh + 3 * k);
            var p = Vector2.Lerp(from, to, t);
            var size = MathHelper.Lerp(toastPx, px, t);
            _ui.Text(_ui.Hud, g.text, p, size, Color.White * (1 - 0.8f * t), 3 * k);
        }
    }

    /// <summary>
    /// Objectives box (hud.css .objectives): gold title, then rows with a checkbox (green tick
    /// when done), optional colour swatch, the text (struck through when done) and progress.
    /// </summary>
    private RectangleF DrawObjectives(Vector2 pos, string title, IReadOnlyList<Objective> items, float k, float alpha, bool measureOnly)
    {
        var px = 11 * k;
        var titlePx = 9 * k;
        var row = px * 1.45f + 3 * k;
        var padL = 9 * k + 3 * k;
        var w = _ui.Hud.Measure(title, titlePx, 0.27f);
        foreach (var it in items)
        {
            var iw = 12 * k + 7 * k + (it.Swatch.HasValue ? 9 * k + 7 * k : 0) + _ui.Ui.Measure(it.Text, px, 0.09f) + (it.Progress != null ? 10 * k + _ui.Hud.Measure(it.Progress, px, 0.09f) : 0);
            w = MathF.Max(w, iw);
        }
        var r = new RectangleF(pos.X, pos.Y, padL + w + 11 * k, 7 * k + titlePx * 1.3f + 2 * k + items.Count * row + 6 * k);
        if (measureOnly) return r;
        _ui.Panel(r, 8 * k, Color.FromNonPremultiplied(14, 20, 30, 117) * alpha);
        _ui.Rect(new RectangleF(r.X, r.Y + 2 * k, 3 * k, r.Height - 4 * k), new Color(0xff, 0xcf, 0x6a) * alpha);
        var y = r.Y + 7 * k;
        _ui.Text(_ui.Hud, title, new Vector2(r.X + padL, y), titlePx, new Color(0xff, 0xcf, 0x6a) * alpha, 0, 0.27f);
        y += titlePx * 1.3f + 2 * k;
        foreach (var it in items)
        {
            var cy = y + row / 2;
            var tx = r.X + padL;
            var box = new RectangleF(tx, cy - 6 * k, 12 * k, 12 * k);
            if (it.Done)
            {
                _ui.Panel(box, 3 * k, new Color(0x7b, 0xe8, 0x6a) * alpha);
                _ui.Line(new Vector2(box.X + 2.6f * k, box.Y + 6.4f * k), new Vector2(box.X + 5 * k, box.Y + 9 * k), 1.8f * k, new Color(0x1b, 0x1d, 0x21) * alpha);
                _ui.Line(new Vector2(box.X + 5 * k, box.Y + 9 * k), new Vector2(box.X + 9.6f * k, box.Y + 3.2f * k), 1.8f * k, new Color(0x1b, 0x1d, 0x21) * alpha);
            }
            else
            {
                _ui.Outline(box, 3 * k, Color.White * 0.9f * alpha);
            }
            tx += 12 * k + 7 * k;
            if (it.Swatch.HasValue)
            {
                var sw = new RectangleF(tx, cy - 4.5f * k, 9 * k, 9 * k);
                _ui.Rect(sw, Color.White * alpha);
                _ui.Rect(new RectangleF(sw.X + 1.5f * k, sw.Y + 1.5f * k, sw.Width - 3 * k, sw.Height - 3 * k), MissionSwatch[it.Swatch.Value == BlockColor.Red ? 0 : it.Swatch.Value == BlockColor.Green ? 1 : 2] * alpha);
                tx += 9 * k + 7 * k;
            }
            var ta = (it.Done ? 0.6f : 0.92f) * alpha;
            var tw = _ui.Ui.Measure(it.Text, px, 0.09f);
            _ui.Ui.DrawShadowed(_ui.Batch, it.Text, new Vector2(tx, cy - px * 0.6f), px, Color.White * ta, Color.Black * 0.6f * ta, new Vector2(0, k), 0.09f);
            if (it.Done) _ui.Rect(new RectangleF(tx, cy, tw, 1.2f * k), Color.White * 0.5f * alpha);
            if (it.Progress != null)
            {
                var pw = _ui.Hud.Measure(it.Progress, px, 0.09f);
                _ui.Text(_ui.Hud, it.Progress, new Vector2(r.Right - 11 * k - pw, cy - px * 0.55f), px, (it.Done ? new Color(0xff, 0xd3, 0x4a) : Color.White) * alpha, 0, 0.09f);
            }
            y += row;
        }
        return r;
    }

    private static readonly Color[] MissionSwatch = { new(0xe0, 0x1d, 0x22), new(0x36, 0xc2, 0x25), new(0x0e, 0xa2, 0xa8) };

    /// <summary>MISSION  [r] n/100  [g] n/100  [b] n/100 | DOCK n/cap</summary>
    private RectangleF DrawMission(Vector2 pos, float h, Logistics l, float k, float alpha, bool narrow)
    {
        var px = (narrow ? 9 : 11) * k;
        var titlePx = (narrow ? 8 : 9) * k;
        var gap = (narrow ? 6 : 9) * k;
        var pad = (narrow ? 7 : 10) * k;
        var sw = 10 * k;
        var w = pad + _ui.Hud.Measure("MISSION", titlePx, 0.2f);
        var counts = new string[3];
        var goals = new string[3];
        for (var i = 0; i < 3; i++)
        {
            counts[i] = l.Delivered[i].ToString();
            goals[i] = $"/{Logistics.Goal[i]}";
            w += gap + sw + 5 * k + MathF.Max(18 * k, _ui.Hud.Measure(counts[i], px, 0.14f)) + _ui.Hud.Measure(goals[i], px, 0.14f);
        }
        var dock = $"DOCK {l.Dock.Count}/{l.Dock.Capacity}";
        if (!narrow) w += gap + 5 * k + _ui.Hud.Measure(dock, titlePx, 0.2f);
        w += pad;
        var r = new RectangleF(pos.X, pos.Y, w, h);
        _ui.Panel(r, 8 * k, PanelFill * alpha);
        var cy = r.Center.Y;
        var tx = r.X + pad;
        _ui.Text(_ui.Hud, "MISSION", new Vector2(tx, cy - titlePx * 0.55f), titlePx, Color.White * 0.74f * alpha, 0, 0.2f);
        tx += _ui.Hud.Measure("MISSION", titlePx, 0.2f);
        for (var i = 0; i < 3; i++)
        {
            tx += gap;
            var done = l.Delivered[i] >= Logistics.Goal[i];
            var sq = new RectangleF(tx, cy - sw / 2, sw, sw);
            _ui.Rect(sq, Color.White * alpha);
            _ui.Rect(new RectangleF(sq.X + 1.5f * k, sq.Y + 1.5f * k, sq.Width - 3 * k, sq.Height - 3 * k), MissionSwatch[i] * alpha);
            tx += sw + 5 * k;
            var cw = MathF.Max(18 * k, _ui.Hud.Measure(counts[i], px, 0.14f));
            var numColor = done ? new Color(0xff, 0xd3, 0x4a) : Color.White * 0.92f;
            _ui.Text(_ui.Hud, counts[i], new Vector2(tx + cw - _ui.Hud.Measure(counts[i], px, 0.14f), cy - px * 0.55f), px, numColor * alpha, 0, 0.14f);
            tx += cw;
            _ui.Text(_ui.Hud, goals[i], new Vector2(tx, cy - px * 0.55f), px, (done ? new Color(0xff, 0xd3, 0x4a) : Color.White * 0.55f) * alpha, 0, 0.14f);
            tx += _ui.Hud.Measure(goals[i], px, 0.14f);
        }
        if (!narrow)
        {
            tx += gap;
            _ui.Rect(new RectangleF(tx, r.Y + 5 * k, k, r.Height - 10 * k), Color.White * 0.3f * alpha);
            tx += 5 * k;
            _ui.Text(_ui.Hud, dock, new Vector2(tx, cy - titlePx * 0.55f), titlePx, Color.White * 0.7f * alpha, 0, 0.2f);
        }
        return r;
    }

    /// <summary>Cargo chopper countdown (2:00 -> 0:00, the last 10 s pulse), or its loading progress.</summary>
    private RectangleF DrawChopper(Vector2 pos, float h, GameSession s, float k, float alpha, bool narrow)
    {
        var l = s.Logistics;
        var ch = l.Chinook;
        var loading = ch.Active && ch.PickupMission;
        var remaining = MathF.Max(0, l.Timer);
        var urgent = !loading && remaining <= 10;
        string label, time;
        float fill;
        if (loading)
        {
            label = "CARGO CHOPPER LOADING";
            time = $"{ch.Loaded} ⬆";
            fill = 1;
        }
        else
        {
            var secs = (int)MathF.Ceiling(remaining);
            label = "CARGO CHOPPER IN";
            time = urgent ? remaining.ToString("0.0") : $"{secs / 60}:{secs % 60:00}";
            fill = MathF.Min(1, remaining / l.Interval);
        }
        var labelPx = (narrow ? 8 : 9) * k;
        var timePx = (urgent ? (narrow ? 13 : 20) : narrow ? 11 : 15) * k;
        var pad = (narrow ? 7 : 10) * k;
        var gap = (narrow ? 6 : 9) * k;
        var labelW = _ui.Hud.Measure(label, labelPx, 0.2f);
        var timeW = MathF.Max(40 * k, _ui.Hud.Measure(time, timePx));
        var barW = narrow ? 60 * k : 70 * k;
        var w = MathF.Max(narrow ? 0 : 260 * k, pad + 14 * k + gap + labelW + gap + timeW + gap + barW + pad);
        barW = w - (pad + 14 * k + gap + labelW + gap + timeW + gap + pad);
        var r = new RectangleF(pos.X, pos.Y, w, h);
        var scale = urgent ? 1 + 0.03f * (1 - MathF.Cos(_time * MathF.PI / 0.5f)) : 1;
        if (scale != 1)
        {
            // Pulse grows from the left edge (transform-origin: left center) + gold glow.
            r = new RectangleF(r.X, r.Center.Y - h * scale / 2, w * scale, h * scale);
            _ui.Panel(new RectangleF(r.X - 4 * k, r.Y - 4 * k, r.Width + 8 * k, r.Height + 8 * k), 12 * k, new Color(255, 211, 74) * (0.18f * (scale - 1) / 0.06f * alpha));
        }
        var bg = loading ? Color.FromNonPremultiplied(30, 90, 40, 153) : urgent ? Color.FromNonPremultiplied(120, 20, 10, 153) : PanelFill;
        _ui.Panel(r, 8 * k, bg * alpha);
        var cy = r.Center.Y;
        var tx = r.X + pad * scale;
        // Little helicopter icon: body, tail and rotor.
        var ic = new Vector2(tx + 7 * k, cy + 1 * k);
        _ui.Disc(ic, 4 * k, Color.White * alpha);
        _ui.Line(ic, ic + new Vector2(8 * k, -1 * k), 2 * k, Color.White * alpha);
        _ui.Line(ic + new Vector2(-6 * k, -6 * k), ic + new Vector2(8 * k, -6 * k), 1.5f * k, Color.White * alpha);
        tx += (14 * k + gap) * scale;
        _ui.Text(_ui.Hud, label, new Vector2(tx, cy - labelPx * scale * 0.55f), labelPx * scale, Color.White * 0.85f * alpha, 0, 0.2f);
        tx += (labelW + gap) * scale;
        var timeColor = urgent ? new Color(0xff, 0xd3, 0x4a) : Color.White;
        _ui.Text(_ui.Hud, time, new Vector2(tx, cy - timePx * scale * 0.55f), timePx * scale, timeColor * alpha, 0);
        tx += (timeW + gap) * scale;
        var bar = new RectangleF(tx, cy - 4 * k * scale, barW * scale, 8 * k * scale);
        _ui.Outline(bar, 3 * k, Color.White * 0.9f * alpha);
        var fillColor = loading ? new Color(0x6e, 0xe0, 0x5a) : urgent ? new Color(0xff, 0xd3, 0x4a) : Color.White;
        _ui.Rect(new RectangleF(bar.X + 3 * k, bar.Y + 3 * k, (bar.Width - 6 * k) * fill, bar.Height - 6 * k), fillColor * alpha);
        return r;
    }

    private void DrawHeart(Vector2 c, float r, float alpha)
    {
        // Rotated rounded square (CSS .heart): white border, red fill, dark drop.
        var b = _ui.Batch;
        b.Draw(_ui.White, c + new Vector2(0, 2 * _ui.Scale), null, Dark * alpha, MathF.PI / 4, new Vector2(0.5f), r * 1.5f, SpriteEffects.None, 0);
        b.Draw(_ui.White, c, null, Color.White * alpha, MathF.PI / 4, new Vector2(0.5f), r * 1.5f, SpriteEffects.None, 0);
        b.Draw(_ui.White, c, null, new Color(0xff, 0x3b, 0x3b) * alpha, MathF.PI / 4, new Vector2(0.5f), r * 1.5f - 3 * _ui.Scale, SpriteEffects.None, 0);
    }

    private void DrawSkills(Rectangle vp, GameSession s, float k, float alpha, bool touch)
    {
        var active = s.PowerUps.Active;
        var w = MathF.Min(250 * k, vp.Width * 0.46f);
        var h = 41 * k;
        var right = vp.Right - 16 * k;
        // On phones the turn buttons own the bottom-right corner: the feed sits above them.
        var bottom = vp.Bottom - 16 * k - (touch ? 120 * k : 0);
        var y = bottom - active.Count * (h + 8 * k) + 8 * k;
        foreach (var p in active)
        {
            _skillAge.TryGetValue(p.Type, out var age);
            var slide = MathF.Min(1, age / 0.35f);
            var a = alpha * slide;
            var def = SupplyCatalog.Of(p.Type);
            var color = p.Gem.HasValue ? SupplyCatalog.Of(p.Gem.Value).Css : def.Css;
            var name = p.Gem.HasValue ? SupplyCatalog.Of(p.Gem.Value).Name : def.Name;
            var r = new RectangleF(right - w + (1 - slide) * 28 * k, y, w, h);
            _ui.Panel(r, 8 * k, Color.FromNonPremultiplied(14, 20, 30, 107) * a);
            var key = new RectangleF(r.X + 8 * k, r.Y + (h - 26 * k) / 2, 26 * k, 26 * k);
            _ui.Panel(key, 5 * k, color * a);
            _ui.Rect(new RectangleF(key.X, key.Bottom - 3 * k, key.Width, 3 * k), Color.Black * 0.25f * a);
            _ui.TextCentered(_ui.Hud, p.Type == SupplyType.G ? "◆" : p.Type.ToString(), key.Center, 15 * k, Color.White * a, 2 * k);
            var bx = key.Right + 10 * k;
            var bw = r.Right - 10 * k - bx;
            _ui.Text(_ui.Hud, name, new Vector2(bx, r.Y + 8 * k), 10 * k, Color.White * 0.92f * a, 0, 0.16f);
            var time = p.Duration > 100 ? "" : $"{p.Remaining:0.0}s";
            _ui.Text(_ui.Hud, time, new Vector2(bx + bw - _ui.Hud.Measure(time, 10 * k, 0.05f), r.Y + 8 * k), 10 * k, Color.White * 0.85f * a, 0, 0.05f);
            var bar = new RectangleF(bx, r.Y + 8 * k + 15 * k, bw, 9 * k);
            _ui.Outline(bar, 3 * k, Color.White * 0.95f * a);
            var ratio = Math.Clamp(p.Remaining / p.Duration, 0, 1);
            _ui.Rect(new RectangleF(bar.X + 3.5f * k, bar.Y + 3.5f * k, (bar.Width - 7 * k) * ratio, bar.Height - 7 * k), Color.White * a);
            y += h + 8 * k;
        }
    }

    /// <summary>Pulsing hazard chip at the screen edge a train is about to come in from (hud.css .train-warn).</summary>
    private void DrawTrainWarning(Rectangle vp, Camera3D camera, Vector3 point, bool top, float k)
    {
        var (p, _) = camera.WorldToScreen(point, new Vector2(vp.Width, vp.Height));
        var x = MathHelper.Clamp(p.X, 80 * k, vp.Width - 80 * k);
        var y = top ? 118 * k : vp.Height - 64 * k;
        var phase = 0.5f - 0.5f * MathF.Cos(_time * MathF.PI * 2 / 0.7f);
        var s = 1 + 0.06f * phase;
        const string text = "TRAIN";
        var px = 15 * k * s;
        var arrow = top ? "▼" : "▲";
        var apx = 13 * k * s;
        var tw = _ui.Hud.Measure(text, px, 3 * k / px);
        var aw = _ui.Ui.Measure(arrow, apx);
        var w = (tw + 2 * aw + 16 * k + 28 * k);
        var h = (px * 1.2f + 12 * k);
        var r = new RectangleF(x - w / 2, y - h / 2, w, h);
        var gold = new Color(0xff, 0xd3, 0x4a);
        _ui.SoftDisc(new Vector2(x, y), w * 0.75f, new Color(255, 200, 60) * (0.25f + 0.25f * phase));
        _ui.Panel(r, 8 * k, new Color(40, 30, 6) * 0.88f);
        _ui.Outline(r, 8 * k, gold);
        var bob = (top ? 4 : -4) * k * phase;
        var ax = r.X + 14 * k;
        _ui.Ui.DrawShadowed(_ui.Batch, arrow, new Vector2(ax, y - apx * 0.55f + bob), apx, gold, Color.Black * 0.7f, new Vector2(0, 2 * k));
        _ui.Hud.DrawShadowed(_ui.Batch, text, new Vector2(ax + aw + 8 * k, y - px * 0.55f), px, gold, Color.Black * 0.7f, new Vector2(0, 2 * k), 3 * k / px);
        _ui.Ui.DrawShadowed(_ui.Batch, arrow, new Vector2(ax + aw + 8 * k + tw + 8 * k, y - apx * 0.55f + bob), apx, gold, Color.Black * 0.7f, new Vector2(0, 2 * k));
    }

    private void DrawNoticeAndToast(Rectangle vp, float k)
    {
        if (_notice.HasValue)
        {
            var (text, color, age) = _notice.Value;
            var t = age / 1.2f;
            float a, dy;
            if (t < 0.15f) { a = t / 0.15f; dy = 10 * (1 - a); }
            else if (t < 0.8f) { a = 1; dy = 0; }
            else { a = 1 - (t - 0.8f) / 0.2f; dy = -12 * (1 - a); }
            a *= _cardsFade;
            _ui.TextCentered(_ui.Hud, text, new Vector2(vp.Center.X, vp.Y + 58 * k + 9 * k + dy * k), 18 * k, color * a, 2 * k);
        }
        if (_toast.HasValue)
        {
            var (text, color, age) = _toast.Value;
            var a = MathF.Min(1, age / 0.25f) * _cardsFade;
            var px = Math.Clamp(vp.Width * 0.03f / k, 16, 28) * k;
            var c = new Vector2(vp.Center.X, vp.Y + vp.Height * 0.18f + px * 0.5f - 10 * k * (1 - a));
            // Orange glow (text-shadow 0 0 18px) approximated by a soft blob behind the text.
            var w = _ui.Hud.Measure(text, px);
            // text-shadow: 0 0 18px rgba(255,120,40,0.8) -> two rings of faint offset copies.
            for (var ring = 1; ring <= 2; ring++)
            for (var i = 0; i < 10; i++)
            {
                var ang = i * MathF.PI / 5 + ring * 0.3f;
                var o = new Vector2(MathF.Cos(ang), MathF.Sin(ang)) * (ring * 4.5f * k);
                _ui.Hud.Draw(_ui.Batch, text, new Vector2(c.X - w / 2, c.Y - px * 0.5f) + o, px, new Color(255, 120, 40) * (0.07f * a));
            }
            _ui.Text(_ui.Hud, text, new Vector2(c.X - w / 2, c.Y - px * 0.5f), px, Color.White * a, 3 * k);
        }
    }

    private void DrawFloats(Rectangle vp, Camera3D camera, float k)
    {
        foreach (var f in _floats)
        {
            var (p, visible) = camera.WorldToScreen(f.World, new Vector2(vp.Width, vp.Height));
            if (!visible) continue;
            var t = f.Age / 0.9f;
            float scale, a, rise;
            if (t < 0.15f) { scale = MathHelper.Lerp(0.6f, 1.25f, t / 0.15f); a = t / 0.15f; rise = MathHelper.Lerp(0.3f, 0.6f, t / 0.15f); }
            else if (t < 0.3f) { scale = MathHelper.Lerp(1.25f, 1, (t - 0.15f) / 0.15f); a = 1; rise = MathHelper.Lerp(0.6f, 0.75f, (t - 0.15f) / 0.15f); }
            else { scale = MathHelper.Lerp(1, 0.95f, (t - 0.3f) / 0.7f); a = 1 - (t - 0.3f) / 0.7f; rise = MathHelper.Lerp(0.75f, 2.3f, (t - 0.3f) / 0.7f); }
            var px = 32 * k * scale;
            var drift = f.Drift * k * MathX.Clamp01((t - 0.3f) / 0.7f);
            var w = _ui.Hud.Measure(f.Text, px);
            var pos = new Vector2(vp.X + p.X - w / 2 + drift, vp.Y + p.Y - px * rise);
            _ui.Hud.DrawOutlined(_ui.Batch, f.Text, pos, px, f.Color * a, Color.White * a, 1.5f * k);
        }
    }

    private void DrawTouch(TouchControls t, float k)
    {
        if (!t.Enabled) return;
        // Joystick: base ring + knob under the thumb, only while it is held (the HUD owns the
        // bottom-left corner when idle).
        var active = t.JoystickActive;
        var baseA = 0.5f;
        if (active)
        {
            _ui.SoftDisc(t.Origin, t.StickRadius * 1.25f, new Color(10, 16, 26) * (0.35f * baseA * 2));
            _ui.Ring(t.Origin, t.StickRadius, 2.5f * k, Color.White * baseA);
            _ui.Disc(t.Knob, t.StickRadius * 0.42f, Color.White * 0.75f);
            _ui.Ring(t.Knob, t.StickRadius * 0.42f, 2 * k, new Color(0x1b, 0x1d, 0x21) * 0.4f);
        }
        Button(t.LeftButton, t.TurnLeft, true);
        Button(t.RightButton, t.TurnRight, false);
        // Pause button (two bars).
        var p = (RectangleF)t.PauseButton;
        _ui.Panel(p, 10 * k, PanelFill);
        _ui.Outline(p, 10 * k, Color.White * 0.35f);
        var bw = p.Width * 0.14f;
        _ui.Rect(new RectangleF(p.Center.X - bw * 1.6f, p.Y + p.Height * 0.28f, bw, p.Height * 0.44f), Color.White * 0.9f);
        _ui.Rect(new RectangleF(p.Center.X + bw * 0.6f, p.Y + p.Height * 0.28f, bw, p.Height * 0.44f), Color.White * 0.9f);

        void Button(Rectangle rect, bool down, bool left)
        {
            var r = (RectangleF)rect;
            _ui.Panel(r, r.Width * 0.5f, (down ? new Color(255, 207, 106) * 0.55f : PanelFill * 1.2f));
            _ui.Outline(r, r.Width * 0.5f, Color.White * (down ? 0.95f : 0.55f));
            // Curved arrow: an arc with an arrow head (rotate left / right).
            var c = r.Center;
            var rad = r.Width * 0.24f;
            var dir = left ? -1 : 1;
            const int n = 14;
            Vector2 prev = default;
            for (var i = 0; i <= n; i++)
            {
                var a = MathHelper.Lerp(-MathF.PI * 0.85f, -MathF.PI * 0.15f, i / (float)n);
                if (left) a = -MathF.PI - a;
                var pt = c + new Vector2(MathF.Cos(a), MathF.Sin(a)) * rad + new Vector2(0, rad * 0.25f);
                if (i > 0) _ui.Line(prev, pt, 3.5f * k, Color.White);
                prev = pt;
            }
            var tip = prev;
            var back = new Vector2(-dir, 0) * 0.0f;
            _ui.Line(tip, tip + new Vector2(-dir * rad * 0.55f, -rad * 0.1f) + back, 3.5f * k, Color.White);
            _ui.Line(tip, tip + new Vector2(-dir * rad * 0.1f, -rad * 0.55f), 3.5f * k, Color.White);
            _ui.TextCentered(_ui.Hud, left ? "Q" : "E", c + new Vector2(0, rad * 0.75f), 11 * k, Color.White * 0.7f);
        }
    }

    private void DrawOverlay(Rectangle vp, float k)
    {
        var a = _overlayAlpha;
        // radial-gradient(rgba(10,30,60,0.15) -> 0.45)
        _ui.Rect(vp, new Color(10, 30, 60) * (0.3f * a));
        _ui.Vignette(vp, new Color(10, 30, 60) * (0.35f * a));
        var cx = vp.Center.X;
        var pulse = 0.775f + 0.225f * MathF.Cos(_time * MathF.PI * 2 / 1.2f);
        var promptPx = Math.Clamp(vp.Width * 0.026f / k, 16, 26) * k;
        var prompt = "TAP / PRESS ANY KEY";
        switch (Overlay)
        {
            case Overlay.Title:
            {
                var lw = MathF.Min(vp.Width * 0.62f, 620 * k);
                var lh = lw * _logo.Height / _logo.Width;
                var help = TouchHelp
                    ? new[] { "LEFT THUMB: fly (nose-relative) · ROTATE BUTTONS: turn · weapons fire automatically", "Break the turrets, then the gem! Shoot cargo off the train.", "Stage 1: ship 20 red, 20 green, 20 blue packages · Stage 2: stop the Block Hauler" }
                    : new[] { "WASD fly · ← → / Q E turn · or DRAG · weapons fire automatically", "Break the turrets, then the gem! Shoot cargo off the train.", "Stage 1: ship 20 red, 20 green, 20 blue packages · Stage 2: stop the Block Hauler" };
                var helpPx = Math.Clamp(vp.Width * 0.016f / k, 12, 16) * k;
                var btnH = ContinueAvailable ? 44 * k + 16 * k : 0;
                var total = lh + 18 * k + promptPx + 18 * k + btnH + helpPx * 3.9f;
                var y = vp.Center.Y - total / 2;
                _ui.Texture(_logo, new RectangleF(cx - lw / 2, y + 10 * k, lw, lh), Color.Black * 0.35f * a);
                _ui.Texture(_logo, new RectangleF(cx - lw / 2, y, lw, lh), Color.White * a);
                y += lh + 18 * k;
                _ui.TextCentered(_ui.Hud, prompt, new Vector2(cx, y + promptPx / 2), promptPx * (0.96f + 0.04f * pulse), Color.White * (a * pulse), 3 * k);
                y += promptPx + 18 * k;
                if (ContinueAvailable)
                {
                    ContinueButton = DrawContinue(new Vector2(cx, y), a, k);
                    y += btnH;
                }
                foreach (var line in help)
                {
                    _ui.TextCentered(_ui.Ui, line, new Vector2(cx, y + helpPx / 2), helpPx, Color.White * 0.92f * a, 2 * k);
                    y += helpPx * 1.3f;
                }
                break;
            }
            case Overlay.GameOver:
            {
                var big = Math.Clamp(vp.Width * 0.08f / k, 40, 96) * k;
                var finalPx = Math.Clamp(vp.Width * 0.035f / k, 20, 36) * k;
                var y = vp.Center.Y - (big + 18 * k + finalPx + 18 * k + promptPx + (ContinueAvailable ? 62 * k : 0)) / 2;
                var w = _ui.Hud.Measure("GAME OVER", big);
                var pos = new Vector2(cx - w / 2, y);
                _ui.Hud.Draw(_ui.Batch, "GAME OVER", pos + new Vector2(0, 6 * k), big, new Color(0x17, 0x19, 0x1d) * a);
                _ui.Hud.DrawOutlined(_ui.Batch, "GAME OVER", pos, big, new Color(0xff, 0x4a, 0x3b) * a, new Color(0x17, 0x19, 0x1d) * a, 3 * k);
                y += big + 18 * k;
                _ui.TextCentered(_ui.Hud, $"SCORE {_finalScore:000000}", new Vector2(cx, y + finalPx / 2), finalPx, Color.White * a);
                y += finalPx + 18 * k;
                _ui.TextCentered(_ui.Hud, prompt, new Vector2(cx, y + promptPx / 2), promptPx, Color.White * (a * pulse), 3 * k);
                if (ContinueAvailable) ContinueButton = DrawContinue(new Vector2(cx, y + promptPx + 18 * k), a, k);
                break;
            }
            case Overlay.Won:
            {
                var big = Math.Clamp(vp.Width * 0.07f / k, 36, 88) * k;
                var finalPx = Math.Clamp(vp.Width * 0.03f / k, 18, 32) * k;
                var y = vp.Center.Y - (big + 18 * k + finalPx * 3 + 42 * k + promptPx) / 2;
                const string title = "MISSION COMPLETE";
                var w = _ui.Hud.Measure(title, big);
                var pos = new Vector2(cx - w / 2, y);
                _ui.Hud.Draw(_ui.Batch, title, pos + new Vector2(0, 6 * k), big, new Color(0x17, 0x19, 0x1d) * a);
                _ui.Hud.DrawOutlined(_ui.Batch, title, pos, big, new Color(0xff, 0xd3, 0x4a) * a, new Color(0x17, 0x19, 0x1d) * a, 3 * k);
                y += big + 18 * k;
                _ui.TextCentered(_ui.Hud, "DEPOT SHIPPED · BLOCK HAULER DESTROYED", new Vector2(cx, y + finalPx / 2), finalPx, Color.White * a);
                y += finalPx + 12 * k;
                _ui.TextCentered(_ui.Hud, $"{_delivered[0]} RED · {_delivered[1]} GREEN · {_delivered[2]} BLUE DELIVERED", new Vector2(cx, y + finalPx / 2), finalPx, Color.White * a);
                y += finalPx + 12 * k;
                _ui.TextCentered(_ui.Hud, $"SCORE {_finalScore:000000}", new Vector2(cx, y + finalPx / 2), finalPx, Color.White * a);
                y += finalPx + 18 * k;
                _ui.TextCentered(_ui.Hud, prompt, new Vector2(cx, y + promptPx / 2), promptPx, Color.White * (a * pulse), 3 * k);
                break;
            }
            case Overlay.Pause:
            {
                var big = Math.Clamp(vp.Width * 0.06f / k, 34, 72) * k;
                var bw = 260 * k;
                var bh = 56 * k;
                var count = ShowQuit ? 4 : 3;
                var y = vp.Center.Y - (big + 30 * k + count * (bh + 14 * k)) / 2;
                _ui.TextCentered(_ui.Hud, "PAUSED", new Vector2(cx, y + big / 2), big, Color.White * a, 5 * k);
                y += big + 30 * k;
                ResumeButton = MenuButton("RESUME", new RectangleF(cx - bw / 2, y, bw, bh), a, k, true);
                y += bh + 14 * k;
                RestartButton = MenuButton("RESTART", new RectangleF(cx - bw / 2, y, bw, bh), a, k, false);
                y += bh + 14 * k;
                MainMenuButton = MenuButton("MAIN MENU", new RectangleF(cx - bw / 2, y, bw, bh), a, k, false);
                y += bh + 14 * k;
                QuitButton = ShowQuit ? MenuButton("QUIT", new RectangleF(cx - bw / 2, y, bw, bh), a, k, false) : default;
                break;
            }
        }
    }

    /// <summary>Green CONTINUE · STAGE 2 button (hud.css .continue-btn), centred at the top.</summary>
    private RectangleF DrawContinue(Vector2 topCenter, float a, float k)
    {
        const string label = "CONTINUE · STAGE 2";
        var px = 18 * k;
        var w = _ui.Hud.Measure(label, px, 0.11f) + 44 * k + 30 * k;
        var r = new RectangleF(topCenter.X - w / 2, topCenter.Y, w, 44 * k);
        _ui.Panel(new RectangleF(r.X, r.Y + 4 * k, r.Width, r.Height), 10 * k, new Color(0x1f, 0x5a, 0x18) * a);
        _ui.Panel(r, 10 * k, new Color(0x5c, 0xd0, 0x4a) * a);
        _ui.Outline(r, 10 * k, Color.White * a);
        _ui.Text(_ui.Hud, label, new Vector2(r.X + 22 * k, r.Center.Y - px * 0.55f), px, new Color(0x1b, 0x1d, 0x21) * a, 0, 0.11f);
        var key = new RectangleF(r.Right - 22 * k - 22 * k, r.Center.Y - 10 * k, 22 * k, 20 * k);
        _ui.Outline(key, 3 * k, new Color(0x1b, 0x1d, 0x21) * 0.5f * a);
        _ui.TextCentered(_ui.Hud, "C", key.Center, 12 * k, new Color(0x1b, 0x1d, 0x21) * 0.7f * a);
        return r;
    }

    private RectangleF MenuButton(string label, RectangleF r, float a, float k, bool primary)
    {
        _ui.Panel(r, 12 * k, (primary ? new Color(0xff, 0xcf, 0x6a) * 0.85f : Color.FromNonPremultiplied(14, 20, 30, 170)) * a);
        _ui.Outline(r, 12 * k, Color.White * 0.8f * a);
        _ui.TextCentered(_ui.Hud, label, r.Center, 22 * k, (primary ? new Color(0x1b, 0x1d, 0x21) : Color.White) * a, primary ? 0 : 2 * k, 0.08f);
        return r;
    }
}
