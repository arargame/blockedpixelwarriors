using BlockedPixelWarriors.Assets;
using BlockedPixelWarriors.Core;
using Microsoft.Xna.Framework;

namespace BlockedPixelWarriors.Rendering;

/// <summary>A Three.js PointLight (physically based falloff with a cut-off distance).</summary>
public sealed class PointLight
{
    public Vector3 Position;
    public Vector3 Color = Vector3.One; // linear
    public float Intensity;
    public float Distance = 9;
    public float Decay = 2;
    public bool Enabled = true;
}

/// <summary>
/// Scene lighting as the web World sets it up: hemisphere + shadowed sun + cool fill, the
/// room environment, fog, and a small pool of point lights (explosion flashes, gem glow).
/// Values arrive in Three's units and are converted to what Lit.glfx expects.
/// </summary>
public sealed class LightRig
{
    public const int MaxPointLights = 6;

    public Vector3 SunDirection, SunColor, FillDirection, FillColor;
    public Vector3 HemiSky, HemiGround;
    /// <summary>scene.environmentIntensity (replaces every material's envMapIntensity in Three).</summary>
    public float EnvIntensity = 1;
    /// <summary>RoomEnvironment levels (Data/environment.bin), see Lit.glfx envAt().</summary>
    public Microsoft.Xna.Framework.Graphics.Texture2D EnvMap;
    public Vector3 FogColor;
    public float FogNear, FogFar;
    public Vector3 SunPosition, SunTarget;
    public ShadowData Shadow;
    public readonly List<PointLight> Points = new();

    public static LightRig From(SceneData scene)
    {
        var l = scene.Lights;
        var rig = new LightRig();
        rig.SunPosition = MathX.V3(l.Sun.Position);
        rig.SunTarget = MathX.V3(l.Sun.Target);
        rig.SunDirection = Vector3.Normalize(rig.SunPosition - rig.SunTarget);
        rig.SunColor = MathX.V3(l.Sun.Color) * l.Sun.Intensity;
        rig.Shadow = l.Sun.Shadow;
        if (l.Fill != null)
        {
            rig.FillDirection = Vector3.Normalize(MathX.V3(l.Fill.Position));
            rig.FillColor = MathX.V3(l.Fill.Color) * l.Fill.Intensity;
        }
        // Irradiance * BRDF_Lambert: hemisphere colours are divided by PI here once.
        rig.HemiSky = MathX.V3(l.Hemi.Sky) * l.Hemi.Intensity / MathF.PI;
        rig.HemiGround = MathX.V3(l.Hemi.Ground) * l.Hemi.Intensity / MathF.PI;
        rig.EnvIntensity = l.EnvironmentIntensity;
        rig.FogColor = MathX.V3(scene.Fog.Color);
        rig.FogNear = scene.Fog.Near;
        rig.FogFar = scene.Fog.Far;
        return rig;
    }

    /// <summary>The <paramref name="max"/> brightest enabled point lights (by intensity).</summary>
    public int ActivePoints(Span<PointLight> into)
    {
        var n = 0;
        foreach (var p in Points)
        {
            if (!p.Enabled || p.Intensity <= 0.001f) continue;
            if (n < into.Length) { into[n++] = p; continue; }
            var weakest = 0;
            for (var i = 1; i < n; i++) if (into[i].Intensity < into[weakest].Intensity) weakest = i;
            if (into[weakest].Intensity < p.Intensity) into[weakest] = p;
        }
        return n;
    }
}
