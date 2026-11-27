"""The overlap check's spatial index (review B-24, FM-90): the grid finds exactly the pairs the sweep along x
found whose boxes overlap, and stays fast when many long elements share an x range."""
import random
import time

import pytest

from ifc_boq.federation import box_pairs, ratio, sweep_pairs


def _boxes(n, seed, long_share=0.0, scale=50.0):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        x, y, z = rnd.uniform(0, scale), rnd.uniform(0, scale), rnd.uniform(0, 10)
        if rnd.random() < long_share:
            dx, dy, dz = rnd.uniform(20, 60), rnd.uniform(0.1, 0.4), rnd.uniform(0.2, 0.6)   # beams, pipes along x
        else:
            dx, dy, dz = rnd.uniform(0.05, 3), rnd.uniform(0.05, 3), rnd.uniform(0.0, 3)    # some flat (dz = 0)
        out.append(([x, y, z], [x + dx, y + dy, z + dz]))
    out.sort(key=lambda b: b[0][0])
    return out


@pytest.mark.parametrize("seed,long_share", [(1, 0.0), (2, 0.3), (3, 0.9), (4, 0.05)])
def test_the_grid_finds_every_overlapping_pair_the_sweep_finds_in_the_same_order(seed, long_share):
    boxes = _boxes(1500, seed, long_share)
    overlapping = [(i, j) for i, j in sweep_pairs(boxes) if ratio(boxes[i], boxes[j]) > 0]
    assert box_pairs(boxes) == overlapping


def test_touching_identical_and_nested_boxes():
    boxes = sorted([([0, 0, 0], [1, 1, 1]), ([1, 0, 0], [2, 1, 1]), ([0, 0, 0], [1, 1, 1]), ([0.2, 0.2, 0.2], [0.4, 0.4, 0.4]),
                    ([5, 5, 5], [5, 5, 5]), ([5, 5, 5], [5, 5, 5]), ([0, 0, 3], [100, 0.1, 3.1])], key=lambda b: b[0][0])
    overlapping = [(i, j) for i, j in sweep_pairs(boxes) if ratio(boxes[i], boxes[j]) > 0]
    assert box_pairs(boxes) == overlapping
    assert box_pairs([]) == [] and box_pairs(boxes[:1]) == []


def test_many_boxes_with_long_elements_along_x_are_at_least_ten_times_faster():
    # 20,000 boxes keep the old sweep's run short (about 15 s); at 50,000 the grid took 1.3 s and the sweep 73.5 s
    # (56.7x, review WP-B6, recorded in PROGRESS.md).
    boxes = _boxes(20_000, 7, long_share=0.3, scale=400.0)
    started = time.perf_counter()
    grid = box_pairs(boxes)
    grid_s = time.perf_counter() - started
    started = time.perf_counter()
    swept = [(i, j) for i, j in sweep_pairs(boxes) if ratio(boxes[i], boxes[j]) > 0]
    sweep_s = time.perf_counter() - started
    assert grid == swept
    assert sweep_s / grid_s >= 10, (round(sweep_s, 2), round(grid_s, 2))
