using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>
/// Key-art camera (Game.updateCamera): keeps the poster angle and translates to follow the
/// helicopter with lag and screen shake; converts screen-relative stick input to world moves.
/// </summary>
public sealed class CameraRig
{
    private readonly Vector3 _base;
    private Vector3? _smooth;

    public Camera3D Camera { get; } = new();
    public Vector3 HeliAnchor { get; }
    public float Shake;
    /// <summary>OPTIONS · CAMERA SHAKE (0 = off).</summary>
    public float ShakeScale = 1;
    /// <summary>Past the depot the camera rides along with the heli (same key-art angle).</summary>
    public bool Follow;
    /// <summary>Camera travel from its home position (the "at infinity" scenery moves with it).</summary>
    public Vector3 Travel => new(Camera.Position.X - _base.X, 0, Camera.Position.Z - _base.Z);

    public CameraRig(CameraData data)
    {
        _base = MathX.V3(data.Position);
        Camera.Position = _base;
        Camera.BaseFov = data.Fov;
        Camera.Near = data.Near;
        Camera.Far = data.Far;
        Camera.LensK = data.LensK;
        Camera.Rotation = new Vector3(MathHelper.ToRadians(-data.PitchDeg), MathHelper.ToRadians(-data.YawDeg), MathHelper.ToRadians(data.RollDeg));
        HeliAnchor = MathX.V3(data.HeliAnchor);
        Camera.Update();
    }

    public void Update(float dt, Vector3 heli, bool snap = false)
    {
        var follow = GameConfig.Camera.FollowStrength;
        var desired = _base;
        if (Follow)
        {
            desired.X += heli.X - HeliAnchor.X;
            desired.Z += heli.Z - HeliAnchor.Z;
        }
        else
        {
            desired.X += (heli.X - HeliAnchor.X) * follow;
            desired.Z += (heli.Z - HeliAnchor.Z) * follow * 0.8f;
        }
        if (snap || !_smooth.HasValue) _smooth = desired;
        _smooth = Vector3.Lerp(_smooth.Value, desired, MathX.Damp(3.5f, dt));
        Camera.Position = _smooth.Value;
        if (Shake > 0)
        {
            Shake = MathF.Max(0, Shake - dt * 2.2f);
            var s = Shake * Shake * 0.45f * ShakeScale;
            Camera.Position.X += Rng.Shared.Spread(s);
            Camera.Position.Y += Rng.Shared.Spread(s);
        }
        Camera.Update();
    }

    public void AddShake(float amount) => Shake = MathF.Max(Shake, amount);

    /// <summary>
    /// Maps stick input (screen right = +x, screen down = +y) to a world XZ direction that moves the
    /// helicopter exactly that way ON SCREEN, through the real camera and lens (toCameraRelative).
    /// </summary>
    public Vector2 ToCameraRelative(Vector2 move, Vector3 heli)
    {
        var mag = MathF.Min(1, move.Length());
        if (mag < 1e-3f) return Vector2.Zero;
        var cam = Camera;
        var p = cam.Project(heli);
        var shown = cam.Distort(new Vector2(p.X, p.Y));
        const float step = 0.05f;
        var target = new Vector2(shown.X + move.X / mag * step / cam.Aspect, shown.Y - move.Y / mag * step);
        target = cam.Undistort(target);
        var d = cam.RayDirection(target.X, target.Y);
        var t = (heli.Y - cam.Position.Y) / d.Y;
        var hitX = cam.Position.X + d.X * t - heli.X;
        var hitZ = cam.Position.Z + d.Z * t - heli.Z;
        var len = MathF.Sqrt(hitX * hitX + hitZ * hitZ);
        if (len < 1e-6f) len = 1;
        return new Vector2(hitX / len * mag, hitZ / len * mag);
    }
}
