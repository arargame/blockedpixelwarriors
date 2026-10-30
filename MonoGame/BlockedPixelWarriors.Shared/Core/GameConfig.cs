using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Core;

/// <summary>
/// Gameplay and world layout constants (port of src/config/GameConfig.js). World units: one block
/// is <see cref="BlockSize"/> wide. +Y is up, -Z is away from the camera.
/// </summary>
public static class GameConfig
{
    public const float BlockSize = 1.5f;

    public static class Board
    {
        public const float MinX = -10.5f, MaxX = 7.5f, MinZ = -9f, MaxZ = 10.5f;
        public const float FrameHeight = 1.35f, FrameWidth = 0.9f;
    }

    public static class Blocks
    {
        public const float Hp = 5, ArmoredHp = 14;
        public const float SupplyChance = 0.2f, ArmoredChance = 0.2f;
        public const float ChainDelay = 0.09f;
        /// <summary>Green gem acid: damage every AcidTick seconds, random in [min, max].</summary>
        public const float AcidTick = 1, AcidDamageMin = 1, AcidDamageMax = 2;
        public const float MaxDropDistance = 7;
    }

    public static class Track
    {
        public const float X = 3.0f, StartZ = -95, EndZ = 55, Gauge = 1.9f, RailTop = 0.42f;
    }

    public static class Heli
    {
        public const float Altitude = 2.7f, Speed = 10, Accel = 4.5f;
        public const float TurnRate = 7, KeyTurnRate = 2.6f, YawAccel = 16;
        /// <summary>Stick more than this far behind the nose flies backwards (no auto turn-around).</summary>
        public const float ReverseAngle = 1.75f, ReverseTurnRate = 0;
        public const float MaxHp = 100;
        public const float MainInterval = 0.13f;
        public const float AimCone = 0.3f, AimRange = 18;
        public const float TripleInterval = 0.28f, BurstInterval = 0.42f, BurstRange = 10;
        public const float HomingInterval = 0.22f, HomingRange = 12;
        public const float Margin = 1.4f;
        public const float Radius = 1.3f;
        public const float DefaultYaw = -0.42f;
    }

    public static class Train
    {
        public const float Speed = 3.2f;
        public const int WagonCount = 6, GrowEvery = 1, MaxWagons = 14;
        public const float RespawnDelay = 4, TurretFireInterval = 1.4f;
        public const float FastChance = 0.3f, SlowChance = 0.3f, FastMul = 1.9f, SlowMul = 0.55f;
        public const float StopChance = 0.65f, StopDuration = 3, StoppedFireMul = 0.4f;
        public const float CannonIntervalMin = 1.2f, CannonIntervalMax = 2.8f;
        public const float TurretBulletDamage = 4, GemShieldMul = 0.05f;
        public const float WreckSpeed = 14, WreckAccel = 6;
        public const float CollisionDamage = 25, RestockChance = 0.6f;
        public const float Scale = 1.6f;
        /// <summary>Head position of the locomotive in the poster frame.</summary>
        public const float PosterHeadZ = 2.8f;
    }

    public static class Supply
    {
        public const float DurationMin = 8, DurationMax = 15;
        public const float PickupRadius = 1.25f, CrateLifetime = 18;
        public const float MagnetRadius = 5.2f, MagnetAccel = 30, MagnetDamping = 1.05f;
        public const float HealAmount = 35;
        public const float GemDamageMul = 1.25f;
    }

    public static class Camera
    {
        public const float FollowStrength = 0.2f;
        public static readonly Vector3 Position = new(-8.6f, 11.7f, 13.8f);
        public const float PitchDeg = 42, YawDeg = 19, RollDeg = 0, Fov = 60, LensK = 0.18f;
        public static readonly Vector2 HeliScreen = new(850, 690);
        /// <summary>Key-art reference resolution used for screen placements.</summary>
        public static readonly Vector2 Reference = new(1672, 941);
    }
}

/// <summary>Block colour keys in pick order (Palette.js BLOCK_COLOR_KEYS).</summary>
public enum BlockColor { Red, Green, Teal, Yellow }

public static class Palette
{
    public static readonly BlockColor[] BlockColors = { BlockColor.Red, BlockColor.Green, BlockColor.Teal, BlockColor.Yellow };

    /// <summary>sRGB colours as authored (UI / particles).</summary>
    public static Color Block(BlockColor c) => c switch
    {
        BlockColor.Red => new Color(0xe0, 0x1d, 0x22),
        BlockColor.Green => new Color(0x36, 0xc2, 0x25),
        BlockColor.Teal => new Color(0x0e, 0xa2, 0xa8),
        _ => new Color(0xf6, 0xbd, 0x10),
    };

    public static string Key(BlockColor c) => c switch
    {
        BlockColor.Red => "red",
        BlockColor.Green => "green",
        BlockColor.Teal => "teal",
        _ => "yellow",
    };

    public static BlockColor FromKey(string key) => key switch
    {
        "red" => BlockColor.Red,
        "green" => BlockColor.Green,
        "teal" => BlockColor.Teal,
        _ => BlockColor.Yellow,
    };

    /// <summary>sRGB byte colour to linear float RGB (what the shaders work in).</summary>
    public static Vector3 ToLinear(Color c) => new(SrgbToLinear(c.R / 255f), SrgbToLinear(c.G / 255f), SrgbToLinear(c.B / 255f));

    public static Vector3 ToLinear(uint hex) => ToLinear(new Color((int)((hex >> 16) & 255), (int)((hex >> 8) & 255), (int)(hex & 255)));

    public static float SrgbToLinear(float c) => c <= 0.04045f ? c / 12.92f : MathF.Pow((c + 0.055f) / 1.055f, 2.4f);
}
