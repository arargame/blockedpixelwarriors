using BlockedPixelWarriors.Assets;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace BlockedPixelWarriors.Rendering;

/// <summary>A static instanced set (.bpi): template mesh + uploaded instance transforms.</summary>
public sealed class InstancedModel
{
    public GpuMesh Mesh;
    public InstanceBuffer Instances;
    public Matrix World;
}

/// <summary>
/// GPU model cache (Flyweight): every exported mesh is uploaded once and shared by all the
/// entities that draw it. Materials are built from the exported data with the right colour space.
/// </summary>
public sealed class ModelLibrary : IDisposable
{
    private readonly GraphicsDevice _device;
    private readonly AssetStore _assets;
    private readonly SceneData _scene;
    private readonly Dictionary<string, GpuMesh> _meshes = new();
    private readonly List<IDisposable> _owned = new();

    public ModelLibrary(GraphicsDevice device, AssetStore assets, SceneData scene)
    {
        _device = device;
        _assets = assets;
        _scene = scene;
    }

    public GraphicsDevice Device => _device;
    public AssetStore Assets => _assets;

    public bool IsSrgb(string texture) =>
        texture == null || _scene.Textures == null || !_scene.Textures.TryGetValue(texture, out var space) || space == "srgb";

    public RenderMaterial Material(MaterialData data) => RenderMaterial.From(data, _assets, IsSrgb);

    /// <summary>Mesh by export name (Content/Models/name.bpm); null when missing or empty.</summary>
    public GpuMesh Mesh(string name)
    {
        if (_meshes.TryGetValue(name, out var m)) return m;
        try
        {
            m = GpuMesh.Create(_device, name, _assets.Mesh(name), Material);
        }
        catch (FileNotFoundException)
        {
            m = null;
        }
        _meshes[name] = m;
        if (m != null) _owned.Add(m);
        return m;
    }

    public InstancedModel Instanced(string name)
    {
        var file = _assets.Instances(name);
        var mesh = GpuMesh.Create(_device, name, file.Template, Material);
        if (mesh == null) return null;
        var buffer = InstanceBuffer.FromStatic(_device, file.Instances);
        _owned.Add(mesh);
        _owned.Add(buffer);
        return new InstancedModel { Mesh = mesh, Instances = buffer, World = file.MeshMatrix };
    }

    /// <summary>Texture with its colour space (true = sRGB, decode in the shader).</summary>
    public (Texture2D texture, bool srgb) Texture(string name) => (_assets.Texture(name), IsSrgb(name));

    public void Dispose()
    {
        foreach (var d in _owned) d.Dispose();
    }
}
