"""G: transitive colourings up to 8 colours by low-index subgroup search (Sims), canonical by BFS order."""
import sys, time
sys.setrecursionlimit(10000)

def colourings(p, q, r, k):
    """All transitive actions of the (p,q,r) reflection group on k points, up to relabelling (point 0 fixed as
    the start), each as three involutions; canonical = points numbered in the order a BFS from 0 meets them."""
    rel = [((0, 1), p), ((0, 2), q), ((1, 2), r)]
    out = []
    t = [[None] * k for _ in range(3)]            # t[g][x] = image of x under s_g (involution)

    def consistent():
        # every relator (a b)^m must close where fully defined, and must not close early on a cycle
        for (a, b), m in rel:
            for x in range(k):
                y, steps = x, 0
                ok = True
                for i in range(m):
                    y1 = t[a][y]
                    if y1 is None: ok = False; break
                    y2 = t[b][y1]
                    if y2 is None: ok = False; break
                    y = y2
                    if y == x:
                        if m % (i + 1) != 0: return False
                        break
                if ok and y != x: return False
        return True

    def rec(n_used):
        # first undefined (point, generator) in BFS order
        for x in range(n_used):
            for g in range(3):
                if t[g][x] is None:
                    # candidates: an already used point with t[g][y] undefined (or y = x), or the next new point
                    cands = [y for y in range(n_used) if t[g][y] is None] + ([n_used] if n_used < k else [])
                    for y in cands:
                        t[g][x] = y; t[g][y] = x
                        if consistent():
                            rec(n_used + (1 if y == n_used else 0))
                        t[g][x] = None; t[g][y] = None
                    return
        if n_used == k: out.append([row[:] for row in t])
    rec(1)
    return out

if __name__ == "__main__":
    for g in [(7, 3, 2), (8, 3, 2), (5, 4, 2), (6, 4, 2), (3, 3, 4)]:
        line = []
        t0 = time.time()
        for k in range(2, 9):
            line.append(f"{k}:{len(colourings(*g, k))}")
        print(f"G1 {g}: transitive actions by colour count {' '.join(line)}  [{time.time()-t0:.1f}s]")

def canon(t, k):
    """Smallest BFS relabelling over all start points: equal for actions that differ only by naming."""
    best = None
    for s0 in range(k):
        lab = {s0: 0}; order = [s0]; i = 0
        while i < len(order):
            x = order[i]; i += 1
            for g in range(3):
                y = t[g][x]
                if y not in lab: lab[y] = len(order); order.append(y)
        form = tuple(lab[t[g][x]] for x in order for g in range(3))
        best = form if best is None or form < best else best
    return best

for g in [(7, 3, 2), (8, 3, 2), (5, 4, 2), (4, 5, 2), (6, 4, 2), (3, 3, 4), (2, 3, 7), (3, 7, 2), (5, 5, 5), (12, 3, 2)]:
    t0 = time.time(); line = []
    for k in range(2, 9):
        acts = colourings(*g, k)
        line.append(f"{k}:{len({canon(a, k) for a in acts})}")
    print(f"G2 {g}: colourings up to relabelling by colour count {' '.join(line)}  [{time.time()-t0:.2f}s]")
