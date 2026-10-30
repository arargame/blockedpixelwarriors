using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>
/// Typed front-end for Lit.mgfx: caches every EffectParameter once and applies frame, material
/// and per-draw values separately so redundant uploads are skipped.
/// </summary>
public sealed class LitShader
{
    private readonly Effect _fx;
    private readonly EffectTechnique _lit, _litInstanced, _tile, _shadow, _shadowInstanced;
    private readonly EffectParameter _world, _viewProj, _shadowViewProj, _uvScroll, _camPosVs, _camForward;
    private readonly EffectParameter _baseColor, _emissive, _matParams, _flags, _flags2, _voxel, _normalScale;
    private readonly EffectParameter _sunDir, _sunColor, _fillDir, _fillColor, _hemiSky, _hemiGround, _envIntensity;
    private readonly EffectParameter _cameraPos, _fogColor, _fogRange, _shadowParams, _tileParams, _tileParams2, _groutColor, _snowRect;
    private readonly EffectParameter[] _pointPos = new EffectParameter[LightRig.MaxPointLights];
    private readonly EffectParameter[] _pointColor = new EffectParameter[LightRig.MaxPointLights];
    private readonly EffectParameter _albedo, _normalMap, _shadowMap, _snowMap, _envMap;
    private readonly PointLight[] _active = new PointLight[LightRig.MaxPointLights];

    public float NormalBias { get; set; } = 0.03f;

    public LitShader(Effect fx)
    {
        _fx = fx;
        var t = fx.Techniques;
        _lit = t["Lit"];
        _litInstanced = t["LitInstanced"];
        _tile = t["Tile"];
        _shadow = t["Shadow"];
        _shadowInstanced = t["ShadowInstanced"];
        var p = fx.Parameters;
        _world = p["World"];
        _viewProj = p["ViewProj"];
        _shadowViewProj = p["ShadowViewProj"];
        _uvScroll = p["UvScroll"];
        _camPosVs = p["CameraPosVs"];
        _camForward = p["CameraForward"];
        _baseColor = p["BaseColor"];
        _emissive = p["EmissiveColor"];
        _matParams = p["MatParams"];
        _flags = p["Flags"];
        _flags2 = p["Flags2"];
        _voxel = p["Voxel"];
        _normalScale = p["NormalScale"];
        _sunDir = p["SunDir"];
        _sunColor = p["SunColor"];
        _fillDir = p["FillDir"];
        _fillColor = p["FillColor"];
        _hemiSky = p["HemiSky"];
        _hemiGround = p["HemiGround"];
        _envIntensity = p["EnvIntensity"];
        _cameraPos = p["CameraPos"];
        _fogColor = p["FogColor"];
        _fogRange = p["FogRange"];
        _shadowParams = p["ShadowParams"];
        _tileParams = p["TileParams"];
        _tileParams2 = p["TileParams2"];
        _groutColor = p["GroutColor"];
        _snowRect = p["SnowRect"];
        for (var i = 0; i < LightRig.MaxPointLights; i++)
        {
            _pointPos[i] = p[$"PointPos{i}"];
            _pointColor[i] = p[$"PointColor{i}"];
        }
        _albedo = p["Albedo"];
        _normalMap = p["NormalMap"];
        _shadowMap = p["ShadowMap"];
        _snowMap = p["SnowMap"];
        _envMap = p["EnvMap"];
    }

    /// <summary>Camera, lights, fog and shadow map for the whole frame.</summary>
    public void SetFrame(Camera3D camera, LightRig lights, Matrix shadowViewProj, Texture2D shadowMap, int shadowSize, Texture2D snowMap, Vector4 snowRect)
    {
        _viewProj.SetValue(camera.ViewProjection);
        _shadowViewProj.SetValue(shadowViewProj);
        _camPosVs.SetValue(camera.Position);
        _camForward.SetValue(camera.Forward);
        _cameraPos.SetValue(camera.Position);
        _sunDir.SetValue(lights.SunDirection);
        _sunColor.SetValue(lights.SunColor);
        _fillDir.SetValue(lights.FillDirection);
        _fillColor.SetValue(lights.FillColor);
        _hemiSky.SetValue(lights.HemiSky);
        _hemiGround.SetValue(lights.HemiGround);
        _envIntensity.SetValue(lights.EnvMap != null ? lights.EnvIntensity : 0f);
        _envMap.SetValue(lights.EnvMap);
        _fogColor.SetValue(lights.FogColor);
        _fogRange.SetValue(new Vector2(lights.FogNear, lights.FogFar));
        _shadowParams.SetValue(new Vector4(1f / Math.Max(1, shadowSize), -(lights.Shadow?.Bias ?? 0), 0, shadowMap != null ? 1 : 0));
        _shadowMap.SetValue(shadowMap);
        _snowMap.SetValue(snowMap);
        _snowRect.SetValue(snowRect);
        var n = lights.ActivePoints(_active);
        for (var i = 0; i < LightRig.MaxPointLights; i++)
        {
            if (i < n)
            {
                var l = _active[i];
                _pointPos[i].SetValue(new Vector4(l.Position, l.Distance));
                _pointColor[i].SetValue(new Vector4(l.Color * l.Intensity, l.Decay));
            }
            else
            {
                _pointColor[i].SetValue(Vector4.Zero);
            }
        }
    }

    /// <summary>Overrides the lights for an isolated pass (e.g. disable shadows).</summary>
    public void SetShadowEnabled(bool on, int shadowSize, float bias) =>
        _shadowParams.SetValue(new Vector4(1f / Math.Max(1, shadowSize), bias, 0, on ? 1 : 0));

    public void SetMaterial(RenderMaterial m, in DrawOverrides o, float time)
    {
        var baseColor = o.BaseColor ?? m.BaseColor;
        baseColor *= o.ColorMul;
        _baseColor.SetValue(baseColor);
        _emissive.SetValue(m.Emissive + o.EmissiveAdd);
        _matParams.SetValue(new Vector4(m.Roughness, m.Metalness, m.EnvIntensity, m.AlphaTest));
        var mapFlag = m.Map == null ? 0f : m.MapSrgb ? 1f : 2f;
        _flags.SetValue(new Vector4(mapFlag, m.NormalMap != null ? 1 : 0, m.VertexColors ? 1 : 0, m.Unlit ? 1 : 0));
        _flags2.SetValue(new Vector4(m.EmissiveUsesMap && m.Map != null ? 1 : 0, m.DoubleSided ? 1 : 0, 0, 0));
        _voxel.SetValue(m.Voxel);
        _normalScale.SetValue(m.NormalScale);
        _uvScroll.SetValue(new Vector4(0, m.ScrollV == 0 ? 0 : (time * m.ScrollV) % 1f, NormalBias, m.VertexColors ? 1 : 0));
        _albedo.SetValue(m.Map);
        _normalMap.SetValue(m.NormalMap);
        if (m.Tile != null)
        {
            var t = m.Tile;
            _tileParams.SetValue(new Vector4(t.Origin[0], t.Origin[1], t.Size, t.Grout));
            _tileParams2.SetValue(new Vector4(t.Crop, t.ImageAspect, 0, 0));
            _groutColor.SetValue(new Vector3(t.GroutColor[0], t.GroutColor[1], t.GroutColor[2]));
        }
    }

    /// <summary>Instanced draws carry their colour per instance: Flags.z on, base colour from the material.</summary>
    public void ForceVertexColor(bool on, RenderMaterial m)
    {
        var mapFlag = m.Map == null ? 0f : m.MapSrgb ? 1f : 2f;
        _flags.SetValue(new Vector4(mapFlag, m.NormalMap != null ? 1 : 0, on || m.VertexColors ? 1 : 0, m.Unlit ? 1 : 0));
    }

    public void SetWorld(in Matrix world) => _world.SetValue(world);

    public void ApplyLit(bool instanced, bool tile)
    {
        _fx.CurrentTechnique = tile ? _tile : instanced ? _litInstanced : _lit;
        _fx.CurrentTechnique.Passes[0].Apply();
    }

    public void ApplyShadow(bool instanced)
    {
        _fx.CurrentTechnique = instanced ? _shadowInstanced : _shadow;
        _fx.CurrentTechnique.Passes[0].Apply();
    }

    public void SetShadowCaster(in Matrix shadowViewProj) => _shadowViewProj.SetValue(shadowViewProj);
}
