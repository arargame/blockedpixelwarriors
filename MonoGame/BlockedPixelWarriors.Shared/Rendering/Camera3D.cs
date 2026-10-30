using BlockedPixelWarriors.Core;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Rendering;

/// <summary>
/// Perspective camera with Three.js semantics: vertical FOV in degrees (widened on screens
/// narrower than 16:9, like RenderPipeline.resize), Euler order YXZ, plus the barrel lens model
/// of LensPass so picking and screen placement match what the player sees.
/// </summary>
public sealed class Camera3D
{
    public Vector3 Position;
    /// <summary>Euler angles (radians), Three order 'YXZ'.</summary>
    public Vector3 Rotation;
    public float BaseFov = 60;
    public float Near = 0.5f, Far = 2000;
    public float Aspect { get; private set; } = 16f / 9f;
    public float Fov { get; private set; } = 60;
    public float LensK;

    public Matrix World { get; private set; }
    public Matrix View { get; private set; }
    public Matrix Projection { get; private set; }
    public Matrix ViewProjection { get; private set; }
    public Vector3 Forward => -new Vector3(World.M31, World.M32, World.M33);
    public Vector3 Right => new(World.M11, World.M12, World.M13);
    public Quaternion Orientation => Quaternion.CreateFromRotationMatrix(MathX.RotationYXZ(Rotation.X, Rotation.Y, Rotation.Z));

    public void SetAspect(float aspect)
    {
        Aspect = aspect;
        const float reference = 16f / 9f;
        if (aspect < reference)
        {
            var hTan = MathF.Tan(MathHelper.ToRadians(BaseFov / 2)) * reference;
            Fov = MathF.Min(100, MathHelper.ToDegrees(2 * MathF.Atan(hTan / aspect)));
        }
        else
        {
            Fov = BaseFov;
        }
    }

    public void Update()
    {
        World = MathX.RotationYXZ(Rotation.X, Rotation.Y, Rotation.Z) * Matrix.CreateTranslation(Position);
        View = Matrix.Invert(World);
        Projection = Matrix.CreatePerspectiveFieldOfView(MathHelper.ToRadians(Fov), Aspect, Near, Far);
        ViewProjection = View * Projection;
    }

    /// <summary>World point to undistorted NDC (x, y in -1..1, z = clip depth 0..1).</summary>
    public Vector3 Project(Vector3 p)
    {
        var c = Vector4.Transform(new Vector4(p, 1), ViewProjection);
        return new Vector3(c.X / c.W, c.Y / c.W, c.Z / c.W);
    }

    /// <summary>Three's Vector3.unproject for NDC z = 0.5 rays: world direction through an NDC point.</summary>
    public Vector3 RayDirection(float ndcX, float ndcY)
    {
        var inv = Matrix.Invert(ViewProjection);
        var near = Vector4.Transform(new Vector4(ndcX, ndcY, 0.5f, 1), inv);
        var p = new Vector3(near.X, near.Y, near.Z) / near.W;
        return Vector3.Normalize(p - Position);
    }

    // ---- Lens (LensPass) -------------------------------------------------------------------

    /// <summary>Displayed NDC to the undistorted render NDC (LensPass.undistort).</summary>
    public Vector2 Undistort(Vector2 ndc)
    {
        var k = LensK;
        var a = Aspect;
        var s = 1 / (1 + k * (1 + 1 / (a * a)));
        var f = s * (1 + k * (ndc.X * ndc.X + ndc.Y * ndc.Y / (a * a)));
        return ndc * f;
    }

    /// <summary>Render NDC to displayed NDC (fixed-point inverse of <see cref="Undistort"/>).</summary>
    public Vector2 Distort(Vector2 ndc)
    {
        var d = ndc;
        for (var i = 0; i < 8; i++) d += ndc - Undistort(d);
        return d;
    }

    /// <summary>World point to displayed screen pixels (with lens), visible = in front of the camera.</summary>
    public (Vector2 pixel, bool visible) WorldToScreen(Vector3 p, Vector2 viewport)
    {
        var n = Project(p);
        var d = Distort(new Vector2(n.X, n.Y));
        return (new Vector2((d.X * 0.5f + 0.5f) * viewport.X, (0.5f - d.Y * 0.5f) * viewport.Y), n.Z < 1 && n.Z > 0);
    }

    /// <summary>Ray through a displayed screen pixel (lens honoured) hitting the plane y = height.</summary>
    public Vector3 ScreenToPlane(Vector2 pixel, Vector2 viewport, float height)
    {
        var ndc = Undistort(new Vector2(pixel.X / viewport.X * 2 - 1, 1 - pixel.Y / viewport.Y * 2));
        var d = RayDirection(ndc.X, ndc.Y);
        return Position + d * ((height - Position.Y) / d.Y);
    }
}
