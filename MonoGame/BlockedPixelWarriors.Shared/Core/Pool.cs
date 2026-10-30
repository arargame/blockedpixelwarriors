namespace BlockedPixelWarriors.Core;

/// <summary>
/// Fixed-capacity pool of structs with swap-remove (no allocations after construction).
/// Iterate with <see cref="Count"/> and <see cref="this[int]"/> (by ref); remove while iterating
/// backwards or with <see cref="RemoveAt"/> and re-checking the same index.
/// </summary>
public sealed class StructPool<T> where T : struct
{
    private readonly T[] _items;

    public StructPool(int capacity) => _items = new T[capacity];

    public int Count { get; private set; }
    public int Capacity => _items.Length;

    public ref T this[int index] => ref _items[index];

    /// <summary>Claims a slot (reset to default). Returns false when full.</summary>
    public bool TryAdd(out int index)
    {
        if (Count >= _items.Length)
        {
            index = -1;
            return false;
        }
        index = Count++;
        _items[index] = default;
        return true;
    }

    public ref T Add()
    {
        if (Count >= _items.Length) return ref _items[_items.Length - 1];
        _items[Count] = default;
        return ref _items[Count++];
    }

    /// <summary>O(1) removal: the last item moves into the hole.</summary>
    public void RemoveAt(int index)
    {
        Count--;
        if (index != Count) _items[index] = _items[Count];
    }

    public void Clear() => Count = 0;
}

/// <summary>Reference-type object pool (reuses instances; caller resets state on Rent).</summary>
public sealed class ObjectPool<T> where T : class
{
    private readonly Stack<T> _free = new();
    private readonly Func<T> _factory;

    public ObjectPool(Func<T> factory, int prewarm = 0)
    {
        _factory = factory;
        for (var i = 0; i < prewarm; i++) _free.Push(factory());
    }

    public T Rent() => _free.Count > 0 ? _free.Pop() : _factory();

    public void Return(T item) => _free.Push(item);
}
