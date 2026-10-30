using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Input;
using Microsoft.Xna.Framework.Input.Touch;

namespace BlockedPixelWarriors.Input;

/// <summary>What the player wants the helicopter to do this frame (input-device independent).</summary>
public struct PilotCommand
{
    /// <summary>Screen-relative stick (x right, y down), length 0..1 — joystick / mouse drag.</summary>
    public Vector2 Stick;
    public bool StickActive;
    /// <summary>Keyboard pilot input in the heli's own frame.</summary>
    public float Forward, Strafe;
    /// <summary>Yaw: +1 left (Q / ←), -1 right (E / →).</summary>
    public float Turn;
}

/// <summary>A pointer press this frame (mouse click or new touch), in back-buffer pixels.</summary>
public readonly record struct Tap(Vector2 Position, bool Touch = false);

/// <summary>
/// Unified input (Input.js + mobile controls): keyboard pilot keys, mouse drag joystick on desktop,
/// and on touch screens a floating virtual joystick on the left half plus turn buttons on the right.
/// </summary>
public sealed class GameInput
{
    private KeyboardState _keys, _prevKeys;
    private MouseState _mouse, _prevMouse;
    private Vector2 _dragOrigin;
    private bool _mouseDragging;
    private readonly List<Tap> _taps = new();
    private bool _backPressed;

    public TouchControls Touch { get; }
    public PilotCommand Command { get; private set; }
    public IReadOnlyList<Tap> Taps => _taps;
    /// <summary>Any key / click / tap this frame (title and game-over screens).</summary>
    public bool AnyAction { get; private set; }
    public bool PausePressed { get; private set; }
    public bool BackPressed => _backPressed;
    /// <summary>Last pointer position (mouse, or the latest touch) and whether it moved this frame.</summary>
    public Vector2 Pointer { get; private set; } = new(-9999, -9999);
    public bool PointerMoved { get; private set; }
    /// <summary>The last input came from touch: show the on-screen controls.</summary>
    public bool TouchMode { get; set; }

    public GameInput(bool touchFirst)
    {
        Touch = new TouchControls();
        TouchMode = touchFirst;
    }

    public void Update(Rectangle viewport, float uiScale, bool gameplay)
    {
        _prevKeys = _keys;
        _prevMouse = _mouse;
        _keys = Keyboard.GetState();
        _mouse = Mouse.GetState();
        _taps.Clear();
        AnyAction = false;
        PausePressed = false;
        _backPressed = GamePad.GetState(PlayerIndex.One).Buttons.Back == ButtonState.Pressed && !_backLatched;
        _backLatched = GamePad.GetState(PlayerIndex.One).Buttons.Back == ButtonState.Pressed;

        foreach (var k in _keys.GetPressedKeys())
            if (!_prevKeys.IsKeyDown(k)) AnyAction = true;
        if (Pressed(Keys.Escape) || Pressed(Keys.P)) PausePressed = true;
        if (_backPressed) PausePressed = true;

        // Touch
        var touches = TouchPanel.GetState();
        if (touches.Count > 0) TouchMode = true;
        Touch.Layout(viewport, uiScale);
        Touch.Update(touches, gameplay && TouchMode);
        foreach (var t in touches)
        {
            if (t.State != TouchLocationState.Pressed) continue;
            _taps.Add(new Tap(t.Position, true));
            AnyAction = true;
        }
        PointerMoved = false;
        if (touches.Count > 0)
        {
            Pointer = touches[0].Position;
            PointerMoved = true;
        }
        if (Touch.PauseTapped) PausePressed = true;

        // Mouse (desktop): click = tap, drag = joystick anywhere (web behaviour).
        var mousePos = new Vector2(_mouse.X, _mouse.Y);
        if (touches.Count == 0 && (_mouse.X != _prevMouse.X || _mouse.Y != _prevMouse.Y))
        {
            Pointer = mousePos;
            PointerMoved = true;
        }
        var leftDown = _mouse.LeftButton == ButtonState.Pressed;
        var leftWasDown = _prevMouse.LeftButton == ButtonState.Pressed;
        if (touches.Count == 0 && leftDown && !leftWasDown)
        {
            _taps.Add(new Tap(mousePos));
            AnyAction = true;
            _dragOrigin = mousePos;
            _mouseDragging = true;
            if (_keys.GetPressedKeyCount() == 0) TouchMode = false;
        }
        if (!leftDown) _mouseDragging = false;
        if (_keys.GetPressedKeyCount() > 0) TouchMode = false;

        var cmd = new PilotCommand();
        float forward = (Down(Keys.W) ? 1 : 0) - (Down(Keys.S) ? 1 : 0);
        float strafe = (Down(Keys.D) ? 1 : 0) - (Down(Keys.A) ? 1 : 0);
        var len = MathF.Sqrt(forward * forward + strafe * strafe);
        if (len > 1)
        {
            forward /= len;
            strafe /= len;
        }
        cmd.Forward = forward;
        cmd.Strafe = strafe;
        cmd.Turn = (Down(Keys.Q) || Down(Keys.Left) ? 1 : 0) - (Down(Keys.E) || Down(Keys.Right) ? 1 : 0);

        if (Touch.JoystickActive)
        {
            cmd.Stick = Touch.Stick;
            cmd.StickActive = cmd.Stick.Length() > 0.05f;
        }
        else if (_mouseDragging && gameplay && touches.Count == 0)
        {
            var scale = MathF.Min(viewport.Width, viewport.Height) * 0.12f;
            var d = (mousePos - _dragOrigin) / scale;
            var l = d.Length();
            if (l > 1)
            {
                // Joystick origin follows the cursor so reversing is instant.
                _dragOrigin = mousePos - d / l * scale;
                d /= l;
            }
            cmd.Stick = d;
            cmd.StickActive = d.Length() > 0.05f;
        }
        if (Touch.TurnLeft) cmd.Turn = 1;
        if (Touch.TurnRight) cmd.Turn = -1;
        Command = cmd;
    }

    private bool _backLatched;

    public bool Down(Keys k) => _keys.IsKeyDown(k);

    public bool Pressed(Keys k) => _keys.IsKeyDown(k) && !_prevKeys.IsKeyDown(k);
}

/// <summary>
/// On-screen controls for phones: a floating joystick (appears where the left thumb lands) and
/// two big turn buttons on the right edge, plus the pause button. Multi-touch: each finger is
/// tracked by id, so steering and turning work at the same time.
/// </summary>
public sealed class TouchControls
{
    private int _stickId = -1;
    private Vector2 _origin, _current;
    private int _leftId = -1, _rightId = -1;

    public Rectangle LeftButton { get; private set; }
    public Rectangle RightButton { get; private set; }
    public Rectangle PauseButton { get; private set; }
    public float StickRadius { get; private set; } = 90;
    public Vector2 RestOrigin { get; private set; }
    public bool JoystickActive => _stickId >= 0;
    public Vector2 Origin => _stickId >= 0 ? _origin : RestOrigin;
    public Vector2 Knob => _stickId >= 0 ? _current : RestOrigin;
    public Vector2 Stick { get; private set; }
    public bool TurnLeft => _leftId >= 0;
    public bool TurnRight => _rightId >= 0;
    public bool PauseTapped { get; private set; }
    public bool Enabled { get; private set; }

    public void Layout(Rectangle vp, float ui)
    {
        var size = (int)(78 * ui);
        var gap = (int)(14 * ui);
        var margin = (int)(22 * ui);
        var bottom = vp.Bottom - margin - size;
        RightButton = new Rectangle(vp.Right - margin - size, bottom, size, size);
        LeftButton = new Rectangle(RightButton.X - gap - size, bottom, size, size);
        var p = (int)(44 * ui);
        // Under the WAVE panel (top right), clear of the HUD panels.
        PauseButton = new Rectangle(vp.Right - (int)(16 * ui) - p, vp.Y + (int)(96 * ui), p, p);
        StickRadius = 62 * ui;
        RestOrigin = new Vector2(vp.X + margin + StickRadius * 1.25f, vp.Bottom - margin - StickRadius * 1.25f);
        _half = vp.X + vp.Width * 0.5f;
    }

    private float _half;

    public void Update(TouchCollection touches, bool enabled)
    {
        Enabled = enabled;
        PauseTapped = false;
        if (!enabled)
        {
            _stickId = _leftId = _rightId = -1;
            Stick = Vector2.Zero;
            return;
        }
        var seenStick = false;
        var seenLeft = false;
        var seenRight = false;
        foreach (var t in touches)
        {
            var p = t.Position;
            var hitLeft = Inflate(LeftButton).Contains(p);
            var hitRight = Inflate(RightButton).Contains(p);
            if (t.State == TouchLocationState.Pressed)
            {
                if (PauseButton.Contains(p))
                {
                    PauseTapped = true;
                    continue;
                }
                if (hitLeft) _leftId = t.Id;
                else if (hitRight) _rightId = t.Id;
                else if (_stickId < 0 && p.X < _half)
                {
                    _stickId = t.Id;
                    _origin = p;
                    _current = p;
                }
            }
            if (t.State == TouchLocationState.Released || t.State == TouchLocationState.Invalid) continue;
            if (t.Id == _stickId)
            {
                seenStick = true;
                _current = p;
                var d = (p - _origin) / StickRadius;
                var l = d.Length();
                if (l > 1)
                {
                    // Floating origin follows the thumb (instant reversal, like the web drag).
                    _origin = p - d / l * StickRadius;
                    d /= l;
                }
                Stick = d;
            }
            // Turn buttons stay pressed while the finger is on them (sliding between swaps).
            if (t.Id == _leftId || t.Id == _rightId)
            {
                if (hitLeft) { _leftId = t.Id; seenLeft = true; if (_rightId == t.Id) _rightId = -1; }
                else if (hitRight) { _rightId = t.Id; seenRight = true; if (_leftId == t.Id) _leftId = -1; }
            }
        }
        if (!seenStick)
        {
            _stickId = -1;
            Stick = Vector2.Zero;
        }
        if (!seenLeft) _leftId = -1;
        if (!seenRight) _rightId = -1;
    }

    private static Rectangle Inflate(Rectangle r)
    {
        r.Inflate(r.Width / 6, r.Height / 6);
        return r;
    }
}
