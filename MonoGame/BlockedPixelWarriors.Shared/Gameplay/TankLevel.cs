using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using BlockedPixelWarriors.Fx;
using BlockedPixelWarriors.Input;
using BlockedPixelWarriors.Rendering;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Input;

namespace BlockedPixelWarriors.Gameplay;

/// <summary>
/// Tank level (src/tank/TankLevel.js + PlayerTank.js), menu card IRON TRACKS: an empty test range
/// with the player's Blender tank. W/S drive, A/D turn the hull, the mouse aims the turret, click /
/// SPACE fires (the barrel kicks back and springs home, the shell lands where aimed), the track
/// links roll round both loops at each side's own speed, the tail and turret lamps blink.
/// Phones: the left stick drives, a tap aims and fires. Own camera, lights and effects.
/// </summary>
public sealed class TankLevel
{
    private const float Gravity = 18;
    private readonly GpuMesh _hull, _turret, _barrel, _link, _ground, _shellMesh;
    private readonly Matrix _turretBase, _barrelBase;
    private readonly Vector3 _barrelAxis, _muzzleLocal;
    private readonly TankTrackData _track;
    private readonly InstanceBuffer _links;
    private readonly List<(RenderMaterial mat, Vector3 baseEmissive, bool red)> _lamps = new();
    private readonly List<(Vector3 pos, Vector3 vel)> _shells = new();
    private readonly float[] _trackOffset = new float[2];
    private Vector3 _camPos, _aim;
    private float _shake, _dustTimer, _time;

    public Camera3D Camera { get; } = new() { BaseFov = GameConfig.Tank.CameraFov, Near = 0.5f, Far = 400 };
    public LightRig Lights { get; }
    public Effects Effects { get; }
    public Vector3 Position;
    public float Heading, Speed, TurnRate, TurretYaw, Recoil, RecoilVel, Cooldown;
    public bool Available => _hull != null && _track != null;
    public float ReloadRatio => 1 - Cooldown / GameConfig.Tank.Reload;

    public TankLevel(ModelLibrary models, SceneData scene, Microsoft.Xna.Framework.Graphics.Texture2D envMap, RenderQuality quality)
    {
        var data = scene.Prefabs.Tank;
        _hull = models.Mesh("tank_hull");
        _turret = models.Mesh("tank_turret");
        _barrel = models.Mesh("tank_barrel");
        _link = models.Mesh("tank_link");
        _ground = models.Mesh("tank_ground");
        _shellMesh = models.Mesh("tank_shell");
        _track = data?.Track;

        // Light: soft sky, a warm sun with shadows that follows the tank (TankLevel.js).
        var rig = LightRig.From(scene);
        rig.EnvMap = envMap;
        rig.HemiSky = Palette.ToLinear(0xdfeeff) * 1.1f / MathF.PI;
        rig.HemiGround = Palette.ToLinear(0x5a6448) * 1.1f / MathF.PI;
        rig.SunColor = Palette.ToLinear(0xfff1dc) * 2.6f;
        rig.FillColor = Vector3.Zero;
        rig.FogColor = Palette.ToLinear(0x8fb6d8);
        rig.FogNear = 70;
        rig.FogFar = 150;
        rig.Shadow = new ShadowData { Left = -22, Right = 22, Top = 22, Bottom = -22, Near = 1, Far = 90, Bias = scene.Lights.Sun.Shadow?.Bias ?? -0.0004f };
        rig.Points.Clear();
        Lights = rig;

        BillboardBatch Batch(string tex, int cap, bool additive, int order)
        {
            var (t, srgb) = models.Texture(tex);
            return new BillboardBatch(models.Device, t, srgb, cap, additive, order);
        }
        var cube = models.Mesh("cargo_cube");
        var debrisMaterial = cube.Material.Clone();
        debrisMaterial.BaseColor = Vector4.One;
        debrisMaterial.Roughness = 0.9f;
        var debris = new DebrisSystem(cube, debrisMaterial, new InstanceBuffer(models.Device, 300, true), (_, _) => 0f);
        Effects = new Effects(new ParticleSystem(Batch("smoke", 1500, false, 11)), new ParticleSystem(Batch("glow", 1000, true, 12)),
            new ParticleSystem(Batch("streak", 800, true, 13)), new ParticleSystem(Batch("fireball0", 400, false, 12)), debris, rig, 2);

        if (!Available) return;
        _turretBase = MathX.FromThree(data.TurretMatrix);
        _barrelBase = MathX.FromThree(data.BarrelMatrix);
        _muzzleLocal = MathX.V3(data.Muzzle);
        // The barrel's pitch is baked into its mesh: its axis is the direction to the muzzle.
        _barrelAxis = Vector3.Normalize(Vector3.TransformNormal(_muzzleLocal, _barrelBase));
        _links = new InstanceBuffer(models.Device, _track.Count * 2, true);
        // Blinking lamps: TankRed (tail lamps) and TankAmber (turret rear lamps).
        foreach (var mesh in new[] { _hull, _turret })
        foreach (var part in mesh.Parts)
        {
            var m = part.Material;
            if (m?.Name is "TankRed" or "TankAmber") _lamps.Add((m, m.Emissive, m.Name == "TankRed"));
        }
    }

    /// <summary>Enters the level: tank back at the start.</summary>
    public void Start()
    {
        Position = Vector3.Zero;
        Heading = Speed = TurnRate = TurretYaw = Recoil = RecoilVel = Cooldown = 0;
        _shells.Clear();
        Effects.Clear();
        _aim = new Vector3(0, 0, 14);
        UpdateCamera(0, true);
    }

    public void Update(float dt, GameInput input, Rectangle viewport)
    {
        _time += dt;
        float throttle = (input.Down(Keys.W) || input.Down(Keys.Up) ? 1 : 0) - (input.Down(Keys.S) || input.Down(Keys.Down) ? 1 : 0);
        float turn = (input.Down(Keys.D) || input.Down(Keys.Right) ? 1 : 0) - (input.Down(Keys.A) || input.Down(Keys.Left) ? 1 : 0);
        var cmd = input.Command;
        if (cmd.StickActive && throttle == 0 && turn == 0)
        {
            throttle = MathHelper.Clamp(-cmd.Stick.Y, -1, 1);
            turn = MathHelper.Clamp(cmd.Stick.X, -1, 1);
        }
        // Aim: the ground point under the pointer / tap; a click or tap also fires.
        var fire = input.Down(Keys.Space);
        foreach (var tap in input.Taps)
        {
            if (Ground(tap.Position, viewport) is { } p) _aim = p;
            fire = true;
        }
        if (input.PointerMoved && Ground(input.Pointer, viewport) is { } q) _aim = q;
        Step(dt, throttle, turn, null, fire);
    }

    /// <summary>One simulation step (also driven directly by capture scenarios).</summary>
    public void Step(float dt, float throttle, float turn, Vector3? aim, bool fire)
    {
        if (aim.HasValue) _aim = aim.Value;
        Drive(dt, throttle, turn);
        if (fire) Fire();
        UpdateShells(dt);
        UpdateDust(dt);
        Effects.Update(dt);
        UpdateCamera(dt);
    }

    private Vector3? Ground(Vector2 screen, Rectangle vp)
    {
        var ndc = new Vector2(screen.X / vp.Width * 2 - 1, 1 - screen.Y / vp.Height * 2);
        var dir = Camera.RayDirection(ndc.X, ndc.Y);
        if (!(dir.Y < -1e-4f)) return null; // also rejects NaN (camera not set up yet)
        var p = Camera.Position + dir * (-Camera.Position.Y / dir.Y);
        return float.IsFinite(p.X) && float.IsFinite(p.Z) ? p : null;
    }

    private void Drive(float dt, float throttle, float turn)
    {
        var target = throttle * GameConfig.Tank.Speed * (throttle < 0 ? GameConfig.Tank.ReverseMul : 1);
        var acc = MathF.Abs(target) > MathF.Abs(Speed) ? GameConfig.Tank.Accel : GameConfig.Tank.Brake;
        Speed += Math.Clamp(target - Speed, -acc * dt, acc * dt);
        var turnTarget = -turn * GameConfig.Tank.TurnSpeed * (MathF.Abs(Speed) > 0.1f && Speed < 0 ? -1 : 1);
        TurnRate += (turnTarget - TurnRate) * (1 - MathF.Exp(-8 * dt));
        Heading += TurnRate * dt;
        Position.X = Math.Clamp(Position.X + MathF.Sin(Heading) * Speed * dt, -GameConfig.Tank.Bounds, GameConfig.Tank.Bounds);
        Position.Z = Math.Clamp(Position.Z + MathF.Cos(Heading) * Speed * dt, -GameConfig.Tank.Bounds, GameConfig.Tank.Bounds);

        // Turret toward the aim point at a limited rate.
        var aimYaw = MathF.Atan2(_aim.X - Position.X, _aim.Z - Position.Z) - Heading;
        var d = Wrap(aimYaw - TurretYaw);
        var step = GameConfig.Tank.TurretSpeed * dt;
        TurretYaw = Wrap(TurretYaw + Math.Clamp(d, -step, step));

        // Barrel recoil spring.
        RecoilVel += (-Recoil * GameConfig.Tank.RecoilSpring - RecoilVel * GameConfig.Tank.RecoilDamping) * dt;
        Recoil = MathF.Max(0, Recoil + RecoilVel * dt);
        Cooldown = MathF.Max(0, Cooldown - dt);

        // Tracks: a point at hull x moves at Speed - TurnRate * x along the hull.
        for (var s = 0; s < 2; s++)
            _trackOffset[s] = (_trackOffset[s] + (Speed - TurnRate * _track.X[s]) * dt) % _track.Perimeter;

        // Lamps: tail lamps blink (steady while reversing), amber lamps alternate.
        var phase = _time * MathF.PI * 2 * GameConfig.Tank.BlinkHz;
        var reversing = Speed < -0.2f;
        foreach (var (mat, baseE, red) in _lamps)
        {
            var on = MathF.Sin(phase + (red ? 0 : MathF.PI)) > 0 ? 1 : 0.12f;
            mat.Emissive = baseE * (red && reversing ? 1.4f : on);
        }
    }

    private Matrix HullWorld => Matrix.CreateRotationY(Heading) * Matrix.CreateTranslation(Position);
    private Matrix TurretWorld => Matrix.CreateRotationY(TurretYaw) * _turretBase * HullWorld;
    private Matrix BarrelWorld => Matrix.CreateTranslation(-_barrelAxis * Recoil) * _barrelBase * TurretWorld;

    private void Fire()
    {
        if (Cooldown > 0 || !Available) return;
        Cooldown = GameConfig.Tank.Reload;
        RecoilVel = GameConfig.Tank.RecoilKick;
        var bw = Matrix.CreateTranslation(Vector3.Zero) * _barrelBase * TurretWorld;
        var muzzle = Vector3.Transform(_muzzleLocal, bw);
        var dir = Vector3.Normalize(Vector3.TransformNormal(_muzzleLocal, bw));
        var r = Rng.Shared;
        Effects.MuzzleFlash(muzzle, dir, new Vector4(4, 2.6f, 0.9f, 1), 1.6f);
        Effects.FlashLight(muzzle, 0xffb060, 70, 0.25f, 12);
        for (var i = 0; i < 10; i++)
        {
            var k = r.Range(2, 6);
            Effects.Smoke.Emit(new ParticleSpec
            {
                Position = muzzle + dir * 0.4f, Velocity = dir * k + new Vector3(r.Spread(1.6f), r.Range(0, 1), r.Spread(1.6f)), Drag = 2.4f,
                Life = r.Range(0.6f, 1.2f), Size0 = r.Range(0.5f, 0.8f), Size1 = r.Range(1.8f, 2.6f), Aspect = 1,
                Color0 = new Vector4(0.7f, 0.68f, 0.64f, 0.8f), Color1 = new Vector4(0.85f, 0.85f, 0.86f, 0), HasColor1 = true, RotVel = r.Spread(1),
            });
        }
        _shake = MathF.Max(_shake, 0.35f);
        // Landing point: the aim point, kept within range in the gun's direction.
        var yaw = Heading + TurretYaw;
        var dist = Math.Clamp(MathF.Sqrt((_aim.X - Position.X) * (_aim.X - Position.X) + (_aim.Z - Position.Z) * (_aim.Z - Position.Z)), 6, GameConfig.Tank.ShellRange);
        var target = new Vector3(Position.X + MathF.Sin(yaw) * dist, 0, Position.Z + MathF.Cos(yaw) * dist);
        var h = MathF.Sqrt((target.X - muzzle.X) * (target.X - muzzle.X) + (target.Z - muzzle.Z) * (target.Z - muzzle.Z));
        var T = MathF.Max(0.2f, h / GameConfig.Tank.ShellSpeed);
        var vel = new Vector3((target.X - muzzle.X) / T, (target.Y - muzzle.Y + 0.5f * Gravity * T * T) / T, (target.Z - muzzle.Z) / T);
        _shells.Add((muzzle, vel));
    }

    private void UpdateShells(float dt)
    {
        for (var i = _shells.Count - 1; i >= 0; i--)
        {
            var (pos, vel) = _shells[i];
            vel.Y -= Gravity * dt;
            pos += vel * dt;
            Effects.Fire.Emit(new ParticleSpec { Position = pos, Life = 0.12f, Size0 = 0.45f, Size1 = 0.1f, Aspect = 1, Color0 = new Vector4(3, 1.8f, 0.6f, 1), Color1 = new Vector4(1, 0.4f, 0.1f, 0), HasColor1 = true });
            if (pos.Y <= 0.05f)
            {
                pos.Y = 0.1f;
                Effects.Explosion(pos, 1.1f, 0x7a6a52, 10);
                _shells.RemoveAt(i);
                var d = Vector3.Distance(pos, Position);
                _shake = MathF.Max(_shake, Math.Clamp(0.5f - d * 0.01f, 0.1f, 0.5f));
                continue;
            }
            _shells[i] = (pos, vel);
        }
    }

    private void UpdateDust(float dt)
    {
        _dustTimer -= dt * (MathF.Abs(Speed) + MathF.Abs(TurnRate) * 1.5f);
        if (_dustTimer > 0) return;
        _dustTimer = 0.35f;
        var r = Rng.Shared;
        var hull = HullWorld;
        foreach (var x in _track.X)
        {
            var p = Vector3.Transform(new Vector3(x, 0.2f, -2.3f * (Speed < 0 ? -1 : 1)), hull);
            Effects.Smoke.Emit(new ParticleSpec
            {
                Position = new Vector3(p.X + r.Spread(0.3f), 0.25f, p.Z + r.Spread(0.3f)), Velocity = new Vector3(r.Spread(0.6f), r.Range(0.4f, 1), r.Spread(0.6f)), Drag = 1.5f,
                Life = r.Range(0.8f, 1.4f), Size0 = 0.5f, Size1 = r.Range(1.6f, 2.4f), Aspect = 1,
                Color0 = new Vector4(0.62f, 0.56f, 0.45f, 0.55f), Color1 = new Vector4(0.7f, 0.66f, 0.58f, 0), HasColor1 = true,
            });
        }
    }

    /// <summary>Fixed-angle follow camera behind the start heading, a little shake on shots.</summary>
    private void UpdateCamera(float dt, bool snap = false)
    {
        var want = new Vector3(Position.X, GameConfig.Tank.CameraHeight, Position.Z - GameConfig.Tank.CameraBack);
        _camPos = snap ? want : Vector3.Lerp(_camPos, want, 1 - MathF.Exp(-4 * dt));
        _shake = MathF.Max(0, _shake - dt * 1.6f);
        var r = Rng.Shared;
        Camera.Position = _camPos + (_shake > 0 ? new Vector3(r.Spread(1), r.Spread(1), r.Spread(1)) * _shake * 0.35f : Vector3.Zero);
        // Look at the ground ahead: yaw PI faces +Z, pitch down.
        var pitch = MathF.Atan2(GameConfig.Tank.CameraHeight, GameConfig.Tank.CameraBack + 2.5f);
        Camera.Rotation = new Vector3(-pitch, MathF.PI, 0);
        Lights.SunPosition = new Vector3(Position.X - 14, 30, Position.Z - 10);
        Lights.SunTarget = new Vector3(Position.X, 0, Position.Z);
        Lights.SunDirection = Vector3.Normalize(Lights.SunPosition - Lights.SunTarget);
    }

    public void Submit(RenderQueue queue)
    {
        if (_ground != null) queue.Add(_ground, Matrix.Identity, DrawOverrides.None, false);
        if (!Available) return;
        var hull = HullWorld;
        queue.Add(_hull, hull);
        queue.Add(_turret, TurretWorld);
        queue.Add(_barrel, BarrelWorld);
        // Track links round both loops.
        _links.Count = 0;
        var t = _track;
        var straight = 2 * t.Zc;
        var arc = MathF.PI * t.R;
        for (var s = 0; s < 2; s++)
        {
            var off = -_trackOffset[s];
            for (var k = 0; k < t.Count; k++)
            {
                var dd = (k * t.Perimeter / t.Count + off) % t.Perimeter;
                if (dd < 0) dd += t.Perimeter;
                float z, y, ang;
                if (dd < straight) { z = -t.Zc + dd; y = t.Yc - t.R; ang = 0; }
                else if (dd < straight + arc) { var a = (dd - straight) / t.R; z = t.Zc + MathF.Sin(a) * t.R; y = t.Yc - MathF.Cos(a) * t.R; ang = a; }
                else if (dd < 2 * straight + arc) { z = t.Zc - (dd - straight - arc); y = t.Yc + t.R; ang = MathF.PI; }
                else { var a = (dd - 2 * straight - arc) / t.R; z = -t.Zc - MathF.Sin(a) * t.R; y = t.Yc + MathF.Cos(a) * t.R; ang = MathF.PI + a; }
                _links.Add(Matrix.CreateRotationX(-ang) * Matrix.CreateTranslation(t.X[s], y, z) * hull, Vector4.One);
            }
        }
        _links.Upload();
        queue.Add(_link, Matrix.Identity, DrawOverrides.None, true, 0, RenderLayer.World, _links);
        foreach (var (pos, vel) in _shells)
        {
            var dir = Vector3.Normalize(vel);
            var yaw = MathF.Atan2(dir.X, dir.Z);
            var pitch = -MathF.Asin(Math.Clamp(dir.Y, -1, 1));
            if (_shellMesh != null) queue.Add(_shellMesh, Matrix.CreateRotationX(pitch) * Matrix.CreateRotationY(yaw) * Matrix.CreateTranslation(pos), DrawOverrides.None, false);
        }
        Effects.Submit(queue);
    }

    private static float Wrap(float a)
    {
        while (a > MathF.PI) a -= MathF.PI * 2;
        while (a < -MathF.PI) a += MathF.PI * 2;
        return a;
    }
}
