var hamt = require('../dist_node/hamt');


exports.single = function(test) {
    var h = hamt.set('a', 3, hamt.make());
    test.equal(hamt.get('a', h), 3);
    
    var h1 = hamt.remove('a', h);
    test.equal(hamt.get('a', h1), null);

    test.done();
};

exports.remove_on_empty = function(test) {
    var h = hamt.remove('x', hamt.make());
    test.done();
};

exports.delete_one_entry = function(test) {
    var h1 = hamt.set('b', 5, hamt.set('a', 3, hamt.make()));
    
    var h2 = hamt.remove('a', h1);
    test.equal(hamt.get('a', h2), null);
    test.equal(hamt.get('b', h2), 5);
    
    var h3 = hamt.remove('b', h2);
    test.equal(hamt.get('a', h3), null);
    test.equal(hamt.get('b', h3), null);
    
    test.done();
};

exports.remove_does_not_alter_original = function(test) {
    var h1 = hamt.set('b', 5,hamt.set('a', 3, hamt.make()));
    
    var h2 = hamt.remove('a', h1);
    
    test.equal(hamt.get('a', h1), 3);
    test.equal(hamt.get('b', h1), 5);
    
    test.equal(hamt.get('a', h2), null);
    test.equal(hamt.get('b', h2), 5);
    
    test.done();
};

exports.delete_collision = function(test) {
    var h = hamt.make({'hash': function(){ return 0; }});
    var h1 = hamt.set('b', 5, hamt.set('a', 3, h));
    var h2 = hamt.remove('a', h1);
    
    test.equal(hamt.get('a', h2), null);
    test.equal(hamt.get('b', h2), 5);
    
    test.done();
};

exports.delete_collision_no_exists = function(test) {
    var h = hamt.make({'hash': function(){ return 0; }});
    var h1 = hamt.set('b', 5, hamt.set('a', 3, h));
    var h2 = hamt.remove('c', h1);
    
    test.equal(hamt.get('a', h2), 3);
    test.equal(hamt.get('b', h2), 5);
    test.equal(hamt.get('c', h2), null);

    test.done();
};

exports.remove_many = function(test) {
    var insert = ["n", "U", "p", "^", "h", "w", "W", "x", "S", "f", "H", "m", "g",
               "l", "b", "_", "V", "Z", "G", "o", "F", "Q", "a", "k", "j", "r",
               "B", "A", "y", "\\", "R", "D", "i", "c", "]", "C", "[", "e", "s",
               "t", "J", "E", "q", "v", "M", "T", "N", "L", "K", "Y", "d", "P",
               "u", "I", "O", "`", "X"];
    
    var remove = ["w", "m", "Q", "R", "i", "K", "P", "Y", "D", "g", "y", "L",
                  "b", "[", "a", "t", "j", "W", "J", "G", "q", "r", "p", "U",
                  "v", "h", "S", "_", "d", "x", "I", "F", "f", "n", "B", "\\",
                  "k", "V", "N", "l", "X", "A", "]", "s", "Z", "O", "^", "o",
                  "`", "H", "E", "e", "M", "u", "T", "c", "C"];
    
    var h = hamt.make();
    insert.forEach(function(x) {
        h = hamt.set(x, x, h);
    });
    
    for (var i = 0; i < remove.length; ++i) {
        h = hamt.remove(remove[i], h);
        
        for (var g = 0; g <= i; ++g) {
            test.equal(
                hamt.get(remove[g], h),
                null);
        }
        for (var g = i + 1; g < remove.length; ++g) {
            test.equal(
                hamt.get(remove[g], h),
                remove[g]);
        }
    }

    test.done();
};
