using System.Text.Json;
using System.Text.Json.Serialization;

namespace BlockedPixelWarriors.Assets;

/// <summary>
/// Content/Data/scene.json written by tools/export-monogame.mjs: camera, lights, sky, clouds,
/// post-processing and prefab metadata taken from the running web build.
/// </summary>
public sealed class SceneData
{
    public CameraData Camera { get; set; }
    public LightsData Lights { get; set; }
    public FogData Fog { get; set; }
    public BackdropData Backdrop { get; set; }
    public SkyData Sky { get; set; }
    public SunGlareData SunGlare { get; set; }
    public List<CloudLayerData> Clouds { get; set; }
    public PostData Post { get; set; }
    public float WaterfallScroll { get; set; }
    public PrefabData Prefabs { get; set; }
    public Dictionary<string, List<string>> InstanceSets { get; set; }
    /// <summary>Texture colour spaces ("srgb" / "linear") by export name.</summary>
    public Dictionary<string, string> Textures { get; set; }

    public static SceneData Load(Stream stream)
    {
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, NumberHandling = JsonNumberHandling.AllowReadingFromString };
        return JsonSerializer.Deserialize<SceneData>(stream, options);
    }
}

public sealed class CameraData
{
    public float[] Position { get; set; }
    public float PitchDeg { get; set; }
    public float YawDeg { get; set; }
    public float RollDeg { get; set; }
    public float Fov { get; set; }
    public float Near { get; set; }
    public float Far { get; set; }
    public float LensK { get; set; }
    public float[] HeliAnchor { get; set; }
}

public sealed class LightsData
{
    public HemiData Hemi { get; set; }
    public SunData Sun { get; set; }
    public FillData Fill { get; set; }
    public float EnvironmentIntensity { get; set; }
}

public sealed class HemiData
{
    public float[] Sky { get; set; }
    public float[] Ground { get; set; }
    public float Intensity { get; set; }
}

public sealed class SunData
{
    public float[] Color { get; set; }
    public float Intensity { get; set; }
    public float[] Position { get; set; }
    public float[] Target { get; set; }
    public ShadowData Shadow { get; set; }
}

public sealed class ShadowData
{
    public float Left { get; set; }
    public float Right { get; set; }
    public float Top { get; set; }
    public float Bottom { get; set; }
    public float Near { get; set; }
    public float Far { get; set; }
    public float Bias { get; set; }
    public float NormalBias { get; set; }
    public float Radius { get; set; }
}

public sealed class FillData
{
    public float[] Color { get; set; }
    public float Intensity { get; set; }
    public float[] Position { get; set; }
}

public sealed class FogData
{
    public float[] Color { get; set; }
    public float Near { get; set; }
    public float Far { get; set; }
}

public sealed class BackdropData
{
    public float[] Quaternion { get; set; }
    public float[] Position { get; set; }
}

public sealed class SkyData
{
    public float[] Top { get; set; }
    public float[] Mid { get; set; }
    public float[] Horizon { get; set; }
    public float[] Bottom { get; set; }
    public float[] SunDir { get; set; }
    public float[] SunColor { get; set; }
    public float HorizonOffset { get; set; }
}

public sealed class SunGlareData
{
    public float[] Position { get; set; }
    public float Size { get; set; }
    public float[] Color { get; set; }
}

public sealed class CloudLayerData
{
    public string Parent { get; set; }
    public List<List<CloudData>> Variants { get; set; }
}

public sealed class CloudData
{
    public float X { get; set; }
    public float Y { get; set; }
    public float Z { get; set; }
    public float Size { get; set; }
    public float Aspect { get; set; }
    public float Tint { get; set; }
    public float Alpha { get; set; }
    public float Drift { get; set; }
    public float Wrap { get; set; }
}

public sealed class PostData
{
    public float Exposure { get; set; }
    public float Saturation { get; set; }
    public float Contrast { get; set; }
    public float Vignette { get; set; }
    public float[] SunPos { get; set; }
    public float[] SunColor { get; set; }
    public float SunStrength { get; set; }
    public float[] Haze { get; set; }
    public float HazeStrength { get; set; }
    public float[] Tint { get; set; }
    public BloomData Bloom { get; set; }
    public float ToneMappingExposure { get; set; }
}

public sealed class BloomData
{
    public float Strength { get; set; }
    public float Radius { get; set; }
    public float Threshold { get; set; }
}

public sealed class PrefabData
{
    [JsonPropertyName("car_locomotive")] public CarData Locomotive { get; set; }
    [JsonPropertyName("car_armored")] public CarData Armored { get; set; }
    [JsonPropertyName("car_cargo")] public CarData Cargo { get; set; }
    public TurretData Turret { get; set; }
    public HeliData Heli { get; set; }
    public Dictionary<string, float[]> BlockColors { get; set; }
    public Dictionary<string, string> SupplyCrateTextures { get; set; }
}

public sealed class CarData
{
    public float Length { get; set; }
    public List<float[]> Chimneys { get; set; }
    public List<CannonData> Cannons { get; set; }
    public List<TurretMountData> Turrets { get; set; }
    public List<TargetData> Targets { get; set; }
    public List<CargoSlotData> Cargo { get; set; }
}

public sealed class CannonData
{
    public float[] Muzzle { get; set; }
    public float[] Dir { get; set; }
}

public sealed class TurretMountData
{
    public float[] Position { get; set; }
    public List<float[]> Muzzles { get; set; }
}

public sealed class TargetData
{
    public string Kind { get; set; }
    public float[] Min { get; set; }
    public float[] Max { get; set; }
    public float Hp { get; set; }
}

public sealed class CargoSlotData
{
    public float[] Min { get; set; }
    public float[] Max { get; set; }
    public string Color { get; set; }
    public bool Snow { get; set; }
}

public sealed class TurretData
{
    public List<float[]> Muzzles { get; set; }
}

public sealed class HeliData
{
    public float[] RotorMatrix { get; set; }
    public float[] TailRotorMatrix { get; set; }
    public string RotorAxis { get; set; }
    public string TailAxis { get; set; }
    public Dictionary<string, float[]> Hardpoints { get; set; }
}
