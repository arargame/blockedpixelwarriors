using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Rendering;
using BlockedPixelWarriors.World;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>
/// Player helicopter (Helicopter.js): arcade flight inside the board, banking, rotor animation,
/// hover bob, damage state and weapon hardpoints.
/// </summary>
public sealed class Helicopter : IRenderable
{
    private readonly Board _board;
    private readonly GpuMesh _body, _rotor, _disc, _tail;
    private readonly Matrix _rotorBase, _tailBase;
    private readonly Dictionary<string, Vector3> _hardpoints;
    private float _rotorAngle, _tailAngle;

    public Vector3 Position;
    public Vector3 Spawn;
    public Vector3 Velocity;
    public float Yaw = GameConfig.Heli.DefaultYaw;
    public float TargetYaw = GameConfig.Heli.DefaultYaw;
    public float YawRate, TiltPitch, TiltRoll;
    public bool Steerable = true;
    /// <summary>true: nose turns toward the movement (joystick / drag); false: keyboard pilot mode.</summary>
    public bool FaceMovement = true;
    /// <summary>Pilot yaw input, +1 = turn left (Q), -1 = turn right (E).</summary>
    public float TurnInput;
    public float Hp = GameConfig.Heli.MaxHp;
    public float Time, HitFlash, Invulnerable;
    public float FlickerMul = 1;
    /// <summary>Flight area override (minX, maxX, minZ, maxZ); null = the depot board.</summary>
    public (float, float, float, float)? Bounds;
    public bool Alive = true;
    public bool Visible = true;
    public float Radius => GameConfig.Heli.Radius;
    public Matrix World { get; private set; } = Matrix.Identity;

    public Helicopter(ModelLibrary models, HeliData data, Board board)
    {
        _board = board;
        _body = models.Mesh("heli_body");
        _rotor = models.Mesh("heli_rotor");
        _disc = models.Mesh("heli_rotor_disc");
        _tail = models.Mesh("heli_tail_rotor");
        _rotorBase = data.RotorMatrix != null ? MathX.FromThree(data.RotorMatrix) : Matrix.Identity;
        _tailBase = data.TailRotorMatrix != null ? MathX.FromThree(data.TailRotorMatrix) : Matrix.Identity;
        _hardpoints = data.Hardpoints.ToDictionary(kv => kv.Key, kv => MathX.V3(kv.Value));
        UpdateWorld(0, 0, 0);
    }

    /// <summary>Rotates a heli-local direction (nose = -Z) into world space around Y.</summary>
    public Vector3 ToWorldDirection(Vector3 d) => Vector3.Transform(d, Matrix.CreateRotationY(Yaw));

    /// <summary>World position of a named hardpoint (podL, podR, chinGun, podRearL, exhaustL...).</summary>
    public Vector3 Hardpoint(string name) =>
        _hardpoints.TryGetValue(name, out var p) ? Vector3.Transform(p, World) : Position;

    public void Update(float dt, Vector2 move)
    {
        Time += dt;
        HitFlash = MathF.Max(0, HitFlash - dt);
        Invulnerable = MathF.Max(0, Invulnerable - dt);

        // Inertial flight: velocity builds up and bleeds off smoothly.
        var target = new Vector3(move.X, 0, move.Y) * GameConfig.Heli.Speed;
        var k = MathX.Damp(GameConfig.Heli.Accel, dt);
        var prevVel = Velocity;
        Velocity = Vector3.Lerp(Velocity, target, k);
        Position += Velocity * dt;
        var m = GameConfig.Heli.Margin;
        // Stage bounds (board, bridge corridor or terrace) when the session sets them.
        var (minX, maxX, minZ, maxZ) = Bounds ?? (_board.MinX, _board.MaxX, _board.MinZ, _board.MaxZ);
        Position.X = Math.Clamp(Position.X, minX + m, maxX - m);
        Position.Z = Math.Clamp(Position.Z, minZ + m + 2, maxZ - m - 0.6f);
        Position.Y = GameConfig.Heli.Altitude + MathF.Sin(Time * 2.1f) * 0.12f;

        // Heading: the nose eases toward the stick direction; pulling back flies backwards first.
        float desiredRate = 0;
        var input = move.Length();
        if (Steerable && !FaceMovement)
        {
            desiredRate = TurnInput * GameConfig.Heli.KeyTurnRate;
        }
        else if (Steerable && input > 0.2f)
        {
            TargetYaw = MathF.Atan2(-move.X, -move.Y);
            var dYaw = MathX.WrapAngle(TargetYaw - Yaw);
            var reversing = MathF.Abs(dYaw) > GameConfig.Heli.ReverseAngle;
            var maxRate = reversing ? GameConfig.Heli.ReverseTurnRate : GameConfig.Heli.TurnRate;
            desiredRate = Math.Clamp(dYaw * 2.6f, -maxRate, maxRate) * MathF.Min(1, input * 1.3f);
        }
        else if (!Steerable)
        {
            desiredRate = MathX.WrapAngle(TargetYaw - Yaw) * 4;
        }
        YawRate += (desiredRate - YawRate) * MathX.Damp(GameConfig.Heli.YawAccel, dt);
        Yaw += YawRate * dt;

        // Attitude from motion in the heli's own frame.
        float sinY = MathF.Sin(Yaw), cosY = MathF.Cos(Yaw);
        var forwardSpeed = Velocity.X * -sinY + Velocity.Z * -cosY;
        var rightSpeed = Velocity.X * cosY + Velocity.Z * -sinY;
        var accel = (Velocity - prevVel) / MathF.Max(dt, 1e-3f);
        var forwardAccel = accel.X * -sinY + accel.Z * -cosY;
        var rightAccel = accel.X * cosY + accel.Z * -sinY;
        var targetPitch = -Math.Clamp(forwardSpeed / GameConfig.Heli.Speed * 0.2f + forwardAccel * 0.012f, -0.4f, 0.4f);
        var targetRoll = -Math.Clamp(rightSpeed / GameConfig.Heli.Speed * 0.26f + rightAccel * 0.012f - YawRate * 0.1f, -0.5f, 0.5f);
        var ease = MathX.Damp(5, dt);
        TiltPitch += (targetPitch - TiltPitch) * ease;
        TiltRoll += (targetRoll - TiltRoll) * ease;
        var basePitch = Steerable ? -0.05f : -0.3f;
        var baseRoll = Steerable ? 0 : 0.16f;
        UpdateWorld(TiltPitch + basePitch, Yaw + MathF.Sin(Time * 0.7f) * 0.015f, TiltRoll + baseRoll);

        Visible = Invulnerable <= 0 || (int)MathF.Floor(Invulnerable * 16) % 2 == 0;
        _rotorAngle += dt * 38;
        _tailAngle += dt * 55;
    }

    /// <summary>Sets the attitude directly (calibration / poster frames).</summary>
    public void SetPose(float pitch, float yaw, float roll) => UpdateWorld(pitch, yaw, roll);

    private void UpdateWorld(float pitch, float yaw, float roll) =>
        World = MathX.RotationYXZ(pitch, yaw, roll) * Matrix.CreateTranslation(Position);

    /// <summary>Applies damage; false while invulnerable or dead.</summary>
    public bool TakeDamage(float amount)
    {
        if (!Alive || Invulnerable > 0) return false;
        Hp = MathF.Max(0, Hp - amount);
        HitFlash = 0.15f;
        Invulnerable = 0.25f * FlickerMul;
        if (Hp <= 0) Alive = false;
        return true;
    }

    public void Respawn()
    {
        Hp = GameConfig.Heli.MaxHp;
        Alive = true;
        Invulnerable = 2.5f * FlickerMul;
        Position = Spawn;
        Velocity = Vector3.Zero;
        Yaw = TargetYaw = GameConfig.Heli.DefaultYaw;
        YawRate = 0;
        Visible = true;
        UpdateWorld(0, Yaw, 0);
    }

    public void Submit(RenderQueue queue)
    {
        if (!Visible || !Alive) return;
        var world = World;
        queue.Add(_body, world, DrawOverrides.None, true);
        var rotor = Matrix.CreateRotationY(_rotorAngle) * _rotorBase * world;
        // Blades (BladeGrey is see-through, order 19) and the motion-blur disc (order 20).
        queue.Add(_rotor, rotor, DrawOverrides.None, true, 19);
        queue.Add(_disc, rotor, DrawOverrides.None, false, 20);
        queue.Add(_tail, Matrix.CreateRotationX(_tailAngle) * _tailBase * world, DrawOverrides.None, true);
    }
}
