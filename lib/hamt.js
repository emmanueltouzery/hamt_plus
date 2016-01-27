/**
    @fileOverview Hash Array Mapped Trie.

    Code based on: https://github.com/exclipy/pdata
*/
const hamt = {}; // export

/* Configuration
 ******************************************************************************/
const SIZE = 5;

const BUCKET_SIZE = Math.pow(2, SIZE);

const MASK = BUCKET_SIZE - 1;

const MAX_INDEX_NODE = BUCKET_SIZE / 2;

const MIN_ARRAY_NODE = BUCKET_SIZE / 4;

/*
 ******************************************************************************/
const nothing = ({});

const constant = x => () => x;

/**
    Get 32 bit hash of string.

    Based on:
    http://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript-jquery
*/
const hash = hamt.hash = str => {
    const type = typeof str;
    if (type === 'number')
        return str;
    if (type !== 'string')
        str += '';

    let hash = 0;
    for (let i = 0, len = str.length; i < len; ++i) {
        const c = str.charCodeAt(i);
        hash = (((hash << 5) - hash) + c) | 0;
    }
    return hash;
};

/* Bit Ops
 ******************************************************************************/
/**
    Hamming weight.

    Taken from: http://jsperf.com/hamming-weight
*/
const popcount = (x) => {
    x -= ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    x = (x + (x >> 4)) & 0x0f0f0f0f;
    x += (x >> 8);
    x += (x >> 16);
    return (x & 0x7f);
};

const hashFragment = (shift, h) =>
    (h >>> shift) & MASK;

const toBitmap = x =>
    1 << x;

const fromBitmap = (bitmap, bit) =>
    popcount(bitmap & (bit - 1));

/* Array Ops
 ******************************************************************************/
/**
    Set a value in an array.

    @param mutate Should the input array be mutated?
    @param at Index to change.
    @param v New value
    @param arr Array.
*/
const arrayUpdate = (mutate, at, v, arr) => {
    let out = arr;
    if (!mutate) {
        const len = arr.length;
        out = new Array(len);
        for (let i = 0; i < len; ++i)
            out[i] = arr[i];
    }
    out[at] = v;
    return out;
};

/**
    Remove a value from an array.

    @param mutate Should the input array be mutated?
    @param at Index to remove.
    @param arr Array.
*/
const arraySpliceOut = (mutate, at, arr) => {
    const len = arr.length;
    let i = 0,
        g = 0;
    let out = arr;
    if (mutate) {
        i = g = at;
    } else {
        out = new Array(len - 1);
        while (i < at)
            out[g++] = arr[i++];
        ++i;
    }
    while (i < len)
        out[g++] = arr[i++];
    return out;
};

/**
    Insert a value into an array.

    @param mutate Should the input array be mutated?
    @param at Index to insert at.
    @param v Value to insert,
    @param arr Array.
*/
const arraySpliceIn = (mutate, at, v, arr) => {
    const len = arr.length;
    if (mutate) {
        let i = len;
        while (i >= at)
            arr[i--] = arr[i];
        arr[at] = v;
        return arr;
    }
    let i = 0, g = 0;
    const out = new Array(len + 1);
    while (i < at)
        out[g++] = arr[i++];
    out[at] = v;
    while (i < len)
        out[++g] = arr[i++];
    return out;
};

/* Node Structures
 ******************************************************************************/
const LEAF = 1;
const COLLISION = 2;
const INDEX = 3;
const ARRAY = 4;

/**
    Empty node.
*/
const empty = ({
    __hamt_isEmpty: true
});

const isEmptyNode = x =>
    x === empty || (x && x.__hamt_isEmpty);

/**
    Leaf holding a value.

    @member edit Edit of the node.
    @member hash Hash of key.
    @member key Key.
    @member value Value stored.
*/
const Leaf = (edit, hash, key, value) => ({
    type: LEAF,
    edit: edit,
    hash: hash,
    key: key,
    value: value,
    _modify: Leaf__modify
});

/**
    Leaf holding multiple values with the same hash but different keys.

    @member edit Edit of the node.
    @member hash Hash of key.
    @member children Array of collision children node.
*/
const Collision = (edit, hash, children) => ({
    type: COLLISION,
    edit: edit,
    hash: hash,
    children: children,
    _modify: Collision__modify
});

/**
    Internal node with a sparse set of children.

    Uses a bitmap and array to pack children.

  @member edit Edit of the node.
    @member mask Bitmap that encode the positions of children in the array.
    @member children Array of child nodes.
*/
const IndexedNode = (edit, mask, children) => ({
    type: INDEX,
    edit: edit,
    mask: mask,
    children: children,
    _modify: IndexedNode__modify
});

/**
    Internal node with many children.

    @member edit Edit of the node.
    @member size Number of children.
    @member children Array of child nodes.
*/
const ArrayNode = (edit, size, children) => ({
    type: ARRAY,
    edit: edit,
    size: size,
    children: children,
    _modify: ArrayNode__modify
});

/**
    Is `node` a leaf node?
*/
const isLeaf = node =>
    (node === empty || node.type === LEAF || node.type === COLLISION);

/* Internal node operations.
 ******************************************************************************/
/**
    Expand an indexed node into an array node.

  @param edit Current edit.
    @param frag Index of added child.
    @param child Added child.
    @param mask Index node mask before child added.
    @param subNodes Index node children before child added.
*/
const expand = (edit, frag, child, bitmap, subNodes) => {
    const arr = [];
    let bit = bitmap;
    let count = 0;
    for (let i = 0; bit; ++i) {
        if (bit & 1)
            arr[i] = subNodes[count++];
        bit >>>= 1;
    }
    arr[frag] = child;
    return ArrayNode(edit, count + 1, arr);
};

/**
    Collapse an array node into a indexed node.

  @param edit Current edit.
    @param count Number of elements in new array.
    @param removed Index of removed element.
    @param elements Array node children before remove.
*/
const pack = (edit, count, removed, elements) => {
    const children = new Array(count - 1);
    let g = 0;
    let bitmap = 0;
    for (let i = 0, len = elements.length; i < len; ++i) {
        const elem = elements[i];
        if (i !== removed && !isEmptyNode(elem)) {
            children[g++] = elem;
            bitmap |= 1 << i;
        }
    }
    return IndexedNode(edit, bitmap, children);
};

/**
    Merge two leaf nodes.

    @param shift Current shift.
    @param h1 Node 1 hash.
    @param n1 Node 1.
    @param h2 Node 2 hash.
    @param n2 Node 2.
*/
const mergeLeaves = (edit, shift, h1, n1, h2, n2) => {
    if (h1 === h2)
        return Collision(edit, h1, [n2, n1]);

    const subH1 = hashFragment(shift, h1);
    const subH2 = hashFragment(shift, h2);
    return IndexedNode(edit, toBitmap(subH1) | toBitmap(subH2),
        subH1 === subH2 ? [mergeLeaves(edit, shift + SIZE, h1, n1, h2, n2)] : subH1 < subH2 ? [n1, n2] : [n2, n1]);
};

/**
    Update an entry in a collision list.

    @param hash Hash of collision.
    @param list Collision list.
    @param f Update function.
    @param k Key to update.
*/
const updateCollisionList = (mutate, edit, keyEq, h, list, f, k) => {
    const len = list.length;
    for (let i = 0; i < len; ++i) {
        const child = list[i];
        if (keyEq(k, child.key)) {
            const value = child.value;
            const newValue = f(value);
            if (newValue === value)
                return list;

            return newValue === nothing ? arraySpliceOut(mutate, i, list) : arrayUpdate(mutate, i, Leaf(edit, h, k, newValue), list);
        }
    }

    const newValue = f();
    return newValue === nothing ? list : arrayUpdate(mutate, len, Leaf(edit, h, k, newValue), list);
};

const canEditNode = (edit, node) => edit === node.edit;

/* Editing
 ******************************************************************************/
const Leaf__modify = function(edit, keyEq, shift, f, h, k) {
    if (keyEq(k, this.key)) {
        const v = f(this.value);
        if (v === this.value)
            return this;
        if (canEditNode(edit, this)) {
            this.value = v;
            return this;
        }
        return v === nothing ? empty : Leaf(edit, h, k, v);
    }
    const v = f();
    return v === nothing ? this : mergeLeaves(edit, shift, this.hash, this, h, Leaf(edit, h, k, v));
};

const Collision__modify = function(edit, keyEq, shift, f, h, k) {
    if (h === this.hash) {
        const canEdit = canEditNode(edit, this);
        const list = updateCollisionList(canEdit, edit, keyEq, this.hash, this.children, f, k);
        if (list === this.children)
            return this;

        return list.length > 1 ? Collision(edit, this.hash, list) : list[0]; // collapse single element collision list
    }
    const v = f();
    return v === nothing ? this : mergeLeaves(edit, shift, this.hash, this, h, Leaf(edit, h, k, v));
};

const IndexedNode__modify = function(edit, keyEq, shift, f, h, k) {
    const mask = this.mask;
    const children = this.children;
    const frag = hashFragment(shift, h);
    const bit = toBitmap(frag);
    const indx = fromBitmap(mask, bit);
    const exists = mask & bit;
    const current = exists ? children[indx] : empty;
    const child = current._modify(edit, keyEq, shift + SIZE, f, h, k);

    if (current === child)
        return this;

    const canEdit = canEditNode(edit, this);
    let bitmap = mask;
    let newChildren;
    if (exists && isEmptyNode(child)) { // remove
        bitmap &= ~bit;
        if (!bitmap)
            return empty;
        if (children.length <= 2 && isLeaf(children[indx ^ 1]))
            return children[indx ^ 1] // collapse

        newChildren = arraySpliceOut(canEdit, indx, children);
    } else if (!exists && !isEmptyNode(child)) { // add
        if (children.length >= MAX_INDEX_NODE)
            return expand(edit, frag, child, mask, children);

        bitmap |= bit;
        newChildren = arraySpliceIn(canEdit, indx, child, children);
    } else { // modify
        newChildren = arrayUpdate(canEdit, indx, child, children);
    }

    if (canEdit) {
        this.mask = bitmap;
        this.children = newChildren;
        return this;
    } else {
        return IndexedNode(edit, bitmap, newChildren);
    }
};

const ArrayNode__modify = function(edit, keyEq, shift, f, h, k) {
    let count = this.size;
    const children = this.children;
    const frag = hashFragment(shift, h);
    const child = children[frag];
    const newChild = (child || empty)._modify(edit, keyEq, shift + SIZE, f, h, k);

    if (child === newChild)
        return this;

    const canEdit = canEditNode(edit, this);
    let newChildren;
    if (isEmptyNode(child) && !isEmptyNode(newChild)) { // add
        ++count;
        newChildren = arrayUpdate(canEdit, frag, newChild, children);
    } else if (!isEmptyNode(child) && isEmptyNode(newChild)) { // remove
        --count;
        if (count <= MIN_ARRAY_NODE)
            return pack(edit, count, frag, children);
        newChildren = arrayUpdate(canEdit, frag, empty, children);
    } else { // modify
        newChildren = arrayUpdate(canEdit, frag, newChild, children);
    }

    if (canEdit) {
        this.size = count;
        this.children = newChildren;
        return this;
    } else {
        return ArrayNode(edit, count, newChildren);
    }
};

empty._modify = (edit, keyEq, shift, f, h, k) => {
    const v = f();
    return v === nothing ? empty : Leaf(edit, h, k, v);
};

/*
 ******************************************************************************/
function Map(editable, edit, config, root) {
    this._editable = editable;
    this._edit = edit;
    this._config = config;
    this._root = root;
};

Map.prototype.setRoot = function(newRoot) {
    if (newRoot === this._root)
        return this;
    if (this._editable) {
        this._root = newRoot;
        return this;
    }
    return new Map(this._editable, this._edit, this._config, newRoot);
};

/* Queries
 ******************************************************************************/
/**
    Lookup the value for `key` in `map` using a custom `hash`.

    Returns the value or `alt` if none.
*/
const tryGetHash = hamt.tryGetHash = (alt, hash, key, map) => {
    let node = map._root;
    let shift = 0;
    const keyEq = map._config.keyEq;
    while (true) switch (node.type) {
        case LEAF:
            {
                return keyEq(key, node.key) ? node.value : alt;
            }
        case COLLISION:
            {
                if (hash === node.hash) {
                    const children = node.children;
                    for (let i = 0, len = children.length; i < len; ++i) {
                        const child = children[i];
                        if (keyEq(key, child.key))
                            return child.value;
                    }
                }
                return alt;
            }
        case INDEX:
            {
                const frag = hashFragment(shift, hash);
                const bit = toBitmap(frag);
                if (node.mask & bit) {
                    node = node.children[fromBitmap(node.mask, bit)]
                    shift += SIZE;
                    break;
                }
                return alt;
            }
        case ARRAY:
            {
                node = node.children[hashFragment(shift, hash)];
                if (node) {
                    shift += SIZE;
                    break;
                }
                return alt;
            }
        default:
            return alt;
    }
};

Map.prototype.tryGetHash = function(alt, hash, key) {
    return tryGetHash(alt, hash, key, this);
};

/**
    Lookup the value for `key` in `map` using internal hash function.

    @see `tryGetHash`
*/
const tryGet = hamt.tryGet = (alt, key, map) =>
    tryGetHash(alt, map._config.hash(key), key, map);

Map.prototype.tryGet = function(alt, key) {
    return tryGet(alt, key, this);
};

/**
    Lookup the value for `key` in `map` using a custom `hash`.

    Returns the value or `undefined` if none.
*/
const getHash = hamt.getHash = (hash, key, map) =>
    tryGetHash(undefined, hash, key, map);

Map.prototype.getHash = function(hash, key) {
    return getHash(hash, key, this);
};

/**
    Lookup the value for `key` in `map` using internal hash function.

    @see `get`
*/
const get = hamt.get = (key, map) =>
    tryGetHash(undefined, map._config.hash(key), key, map);

Map.prototype.get = function(key, alt) {
    return tryGet(alt, key, this);
};

/**
    Does an entry exist for `key` in `map`? Uses custom `hash`.
*/
const hasHash = hamt.has = (hash, key, map) =>
    tryGetHash(nothing, hash, key, map) !== nothing;

Map.prototype.hasHash = function(hash, key) {
    return hasHash(hash, key, this);
};

/**
    Does an entry exist for `key` in `map`? Uses internal hash function.
*/
const has = hamt.has = (key, map) =>
    hasHash(map._config.hash(key), key, map);

Map.prototype.has = function(key) {
    return has(key, this);
};

/**

*/
const defKeyCompare = (x, y) => x === y;

hamt.make = (config) =>
    new Map(0, 0, {
        keyEq: (config && config.keyEq) || defKeyCompare,
        hash: (config && config.hash) || hash
    }, empty);

/**
    Does `map` contain any elements?
*/
const isEmpty = hamt.isEmpty = (map) =>
    !!isEmptyNode(map._root);

Map.prototype.isEmpty = function() {
    return isEmpty(this);
};

/* Updates
 ******************************************************************************/
/**
    Alter the value stored for `key` in `map` using function `f` using
    custom hash.

    `f` is invoked with the current value for `k` if it exists,
    or no arguments if no such value exists. `modify` will always either
    update or insert a value into the map.

    Returns a map with the modified value. Does not alter `map`.
*/
const modifyHash = hamt.modifyHash = (f, hash, key, map) => {
    const newRoot = map._root._modify(
        map._editable ? map._edit : NaN,
        map._config.keyEq,
        0,
        f,
        hash,
        key);
    return map.setRoot(newRoot);
};

Map.prototype.modifyHash = function(hash, key, f) {
    return modifyHash(f, hash, key, this);
};

/**
    Alter the value stored for `key` in `map` using function `f` using
    internal hash function.

    @see `modifyHash`
*/
const modify = hamt.modify = (f, key, map) =>
    modifyHash(f, map._config.hash(key), key, map);

Map.prototype.modify = function(key, f) {
    return modify(f, key, this);
};

/**
    Store `value` for `key` in `map` using custom `hash`.

    Returns a map with the modified value. Does not alter `map`.
*/
const setHash = hamt.setHash = (hash, key, value, map) =>
    modifyHash(constant(value), hash, key, map);

Map.prototype.setHash = function(hash, key, value) {
    return setHash(hash, key, value, this);
};

/**
    Store `value` for `key` in `map` using internal hash function.

    @see `setHash`
*/
const set = hamt.set = (key, value, map) =>
    setHash(map._config.hash(key), key, value, map);

Map.prototype.set = function(key, value) {
    return set(key, value, this);
};

/**
    Remove the entry for `key` in `map`.

    Returns a map with the value removed. Does not alter `map`.
*/
const del = constant(nothing);
const removeHash = hamt.removeHash = (hash, key, map) =>
    modifyHash(del, hash, key, map);

Map.prototype.removeHash = Map.prototype.deleteHash = function(hash, key) {
    return removeHash(hash, key, this);
};

/**
    Remove the entry for `key` in `map` using internal hash function.

    @see `removeHash`
*/
const remove = hamt.remove = (key, map) =>
    removeHash(map._config.hash(key), key, map);

Map.prototype.remove = Map.prototype.delete = function(key) {
    return remove(key, this);
};

/* Mutation
 ******************************************************************************/
 /**
     Mark `map` as mutable.
  */
const beginMutation = hamt.beginMutation = (map) =>
    new Map(
        map._editable + 1,
        map._edit + 1,
        map._config,
        map._root);

Map.prototype.beginMutation = function() {
    return beginMutation(this);
};

/**
    Mark `map` as immutable.
 */
const endMutation = hamt.endMutation = (map) => {
    map._editable = map._editable && map._editable - 1;
    return map;
};

Map.prototype.endMutation = function() {
    return endMutation(this);
};

/**
    Mutate `map` within the context of `f`.
    @param f
    @param map HAMT
*/
const mutate = hamt.mutate = (f, map) => {
    const transient = beginMutation(map);
    f(transient);
    return endMutation(transient);
};

Map.prototype.mutate = function(f) {
    return mutate(f, this);
};

/* Traversal
 ******************************************************************************/
/**
    Apply a continuation.
*/
const appk = k =>
    k && lazyVisitChildren(k[0], k[1], k[2], k[3], k[4]);

/**
    Recursively visit all values stored in an array of nodes lazily.
*/
var lazyVisitChildren = (len, children, i, f, k) => {
    while (i < len) {
        const child = children[i++];
        if (child && !isEmptyNode(child))
            return lazyVisit(child, f, [len, children, i, f, k]);
    }
    return appk(k);
};

/**
    Recursively visit all values stored in `node` lazily.
*/
const lazyVisit = (node, f, k) => {
    switch (node.type) {
        case LEAF:
            return {
                value: f(node),
                rest: k
            };

        case COLLISION:
        case ARRAY:
        case INDEX:
            const children = node.children;
            return lazyVisitChildren(children.length, children, 0, f, k);

        default:
            return appk(k);
    }
};

const DONE = {
    done: true
};

/**
    Javascript iterator over a map.
*/
function MapIterator(v) {
    this.v = v;
};

MapIterator.prototype.next = function() {
    if (!this.v)
        return DONE;
    const v0 = this.v;
    this.v = appk(v0.rest);
    return v0;
};

MapIterator.prototype[Symbol.iterator] = function() {
    return this;
};

/**
    Lazily visit each value in map with function `f`.
*/
const visit = (map, f) =>
    new MapIterator(lazyVisit(map._root, f));

/**
    Get a Javascsript iterator of `map`.

    Iterates over `[key, value]` arrays.
*/
const buildPairs = (x) => [x.key, x.value];
const entries = hamt.entries = (map) =>
    visit(map, buildPairs);

Map.prototype.entries = Map.prototype[Symbol.iterator] = function() {
    return entries(this);
};

/**
    Get array of all keys in `map`.

    Order is not guaranteed.
*/
const buildKeys = (x) => x.key;
const keys = hamt.keys = (map) =>
    visit(map, buildKeys);

Map.prototype.keys = function() {
    return keys(this);
}

/**
    Get array of all values in `map`.

    Order is not guaranteed, duplicates are preserved.
*/
const buildValues = x => x.value;
const values = hamt.values = Map.prototype.values = map =>
    visit(map, buildValues);

Map.prototype.values = function() {
    return values(this);
};

/* Fold
 ******************************************************************************/
/**
    Visit every entry in the map, aggregating data.

    Order of nodes is not guaranteed.

    @param f Function mapping accumulated value, value, and key to new value.
    @param z Starting value.
    @param m HAMT
*/
const fold = hamt.fold = (f, z, m) => {
    const root = m._root;
    if (root.type === LEAF)
        return f(z, root.value, root.key);

    const toVisit = [root.children];
    let children;
    while (children = toVisit.pop()) {
        for (let i = 0, len = children.length; i < len;) {
            const child = children[i++];
            if (child && child.type) {
                if (child.type === LEAF)
                    z = f(z, child.value, child.key);
                else
                    toVisit.push(child.children);
            }
        }
    }
    return z;
};

Map.prototype.fold = function(f, z) {
    return fold(f, z, this);
};

/**
    Visit every entry in the map, aggregating data.

    Order of nodes is not guaranteed.

    @param f Function invoked with value and key
    @param map HAMT
*/
const forEach = hamt.forEach = (f, map) =>
    fold((_, value, key) => f(value, key, map), null, map);

Map.prototype.forEach = function(f) {
    return forEach(f, this);
};

/* Aggregate
 ******************************************************************************/
/**
    Get the number of entries in `map`.
*/
const inc = x => x + 1;
const count = hamt.count = map =>
    fold(inc, 0, map);

Map.prototype.count = function() {
    return count(this);
};

Object.defineProperty(Map.prototype, 'size', {
    get: Map.prototype.count
});

/* Export
 ******************************************************************************/
if (typeof module !== 'undefined' && module.exports) {
    module.exports = hamt;
} else if (typeof define === 'function' && define.amd) {
    define('hamt', [], () => hamt);
} else {
    this.hamt = hamt;
}
