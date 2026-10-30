using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Core;

public static class MathX
{
    public static float Clamp01(float v) => v < 0 ? 0 : v > 1 ? 1 : v;

    public static float Lerp(float a, float b, float t) => a + (b - a) * t;

    public static float SmoothStep(float e0, float e1, float x)
    {
        var t = Clamp01((x - e0) / (e1 - e0));
        return t * t * (3 - 2 * t);
    }

    public static float WrapAngle(float a)
    {
        while (a > MathF.PI) a -= MathF.PI * 2;
        while (a < -MathF.PI) a += MathF.PI * 2;
        return a;
    }

    public static float LerpAngle(float a, float b, float t) => a + WrapAngle(b - a) * t;

    /// <summary>Exponential smoothing factor for a rate (1 - e^(-rate*dt)).</summary>
    public static float Damp(float rate, float dt) => 1 - MathF.Exp(-rate * dt);

    /// <summary>
    /// Yaw (radians about +Y) that turns a model whose forward is -Z to face (dx, dz)
    /// (Three.js convention: rotation.y = atan2(-dx, -dz)).
    /// </summary>
    public static float YawFor(float dx, float dz) => MathF.Atan2(-dx, -dz);

    /// <summary>Rotates a heli-local direction (nose = -Z) into world space about +Y.</summary>
    public static Vector3 RotateY(Vector3 v, float yaw)
    {
        var c = MathF.Cos(yaw);
        var s = MathF.Sin(yaw);
        return new Vector3(v.X * c + v.Z * s, v.Y, -v.X * s + v.Z * c);
    }

    public static float HorizontalLength(Vector3 v) => MathF.Sqrt(v.X * v.X + v.Z * v.Z);

    /// <summary>Three.js Object3D order 'YXZ' rotation as a MonoGame (row-vector) matrix.</summary>
    public static Matrix RotationYXZ(float x, float y, float z) =>
        Matrix.CreateRotationZ(z) * Matrix.CreateRotationX(x) * Matrix.CreateRotationY(y);

    /// <summary>Three.js default Euler order 'XYZ' as a MonoGame matrix.</summary>
    public static Matrix RotationXYZ(float x, float y, float z) =>
        Matrix.CreateRotationZ(z) * Matrix.CreateRotationY(y) * Matrix.CreateRotationX(x);

    /// <summary>Three.js Matrix4.elements (column-major) to a MonoGame matrix.</summary>
    public static Matrix FromThree(IReadOnlyList<float> e) => new(
        e[0], e[1], e[2], e[3],
        e[4], e[5], e[6], e[7],
        e[8], e[9], e[10], e[11],
        e[12], e[13], e[14], e[15]);

    public static Vector3 V3(IReadOnlyList<float> a) => new(a[0], a[1], a[2]);
}
