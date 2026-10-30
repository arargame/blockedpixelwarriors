namespace BlockedPixelWarriors.Rendering;

/// <summary>
/// Quality presets (RenderPipeline.js QUALITY): desktop gets everything, phones trade MSAA,
/// shadow resolution, the foreground blur and the lens fringe for frame rate.
/// </summary>
/// <remarks>
/// MonoGame's GL backend only creates 8-bit multisample render targets, which would clamp the
/// HDR scene (no bloom on hot spots), so anti-aliasing is FXAA on the final frame instead of
/// the web build's MSAA, optionally with supersampling (<see cref="Supersample"/>).
/// </remarks>
public sealed record RenderQuality(string Name, bool Fxaa, int ShadowMap, bool Bloom, bool ForegroundBlur, float MaxRenderHeight, bool Adaptive, float Supersample = 1, int FlashLights = 4)
{
    public static readonly RenderQuality High = new("high", true, 4096, true, true, 2160, false);
    public static readonly RenderQuality Medium = new("medium", true, 2048, true, true, 1440, true);
    /// <summary>Phones: like the web "low" preset, rendered at most 720 lines and scaled up.</summary>
    public static readonly RenderQuality Mobile = new("low", false, 1024, true, false, 720, true, 1, 2);

    public static RenderQuality ByName(string name) => name switch
    {
        "medium" => Medium,
        "low" or "mobile" => Mobile,
        _ => High,
    };
}
