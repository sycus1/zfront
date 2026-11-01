package main

import (
	"bytes"
	"context"
	"fmt"
	"image/png"
	"os"
	"strconv"
	"strings"
)

// zfront: a map's hand-made districts. districts.png sits beside image.png,
// the same size, with one flat colour for each district. It is read onto the
// map4x grid (each cell takes the colour most of its 2x2 tiles have) and
// written into the manifest as run-length rows; see MapDistricts in
// packages/engine-api/src/game/MapFiles.ts. Transparent cells join the
// nearest painted district, so only the ground that matters needs paint.

// Pixels at least this opaque are paint; anything fainter is left blank.
const districtAlphaMin = 128

// readDistricts turns a districts.png into the manifest's districts field.
func readDistricts(ctx context.Context, path string, srcW, srcH, mapW, mapH, w4, h4 int) (map[string]interface{}, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("districts.png failed to decode: %w", err)
	}
	size := img.Bounds().Size()
	if !(size.X == mapW && size.Y == mapH) && !(size.X == srcW && size.Y == srcH) {
		return nil, fmt.Errorf("districts.png dimensions (%dx%d) do not match image.png (%dx%d)", size.X, size.Y, srcW, srcH)
	}
	full := cropToNRGBA(img, mapW, mapH)

	ids := make([]int, w4*h4)
	colourID := map[uint32]int{}
	var colours []uint32
	painted := 0
	for y := 0; y < h4; y++ {
		for x := 0; x < w4; x++ {
			// The colour most of the cell's tiles have, the first one seen on a tie.
			var seen [4]uint32
			var votes [4]int
			n := 0
			for dy := 0; dy < 2; dy++ {
				for dx := 0; dx < 2; dx++ {
					tx, ty := 2*x+dx, 2*y+dy
					if tx >= mapW || ty >= mapH {
						continue
					}
					p := full.Pix[full.PixOffset(tx, ty):]
					if p[3] < districtAlphaMin {
						continue
					}
					c := uint32(p[0])<<16 | uint32(p[1])<<8 | uint32(p[2])
					k := 0
					for k < n && seen[k] != c {
						k++
					}
					if k == n {
						seen[n] = c
						n++
					}
					votes[k]++
				}
			}
			ids[y*w4+x] = -1
			if n == 0 {
				continue
			}
			best := 0
			for k := 1; k < n; k++ {
				if votes[k] > votes[best] {
					best = k
				}
			}
			c := seen[best]
			id, ok := colourID[c]
			if !ok {
				id = len(colours)
				colourID[c] = id
				colours = append(colours, c)
			}
			ids[y*w4+x] = id
			painted++
		}
	}
	if painted == 0 {
		return nil, fmt.Errorf("districts.png has no painted pixels")
	}
	if len(colours) > 0xffff {
		return nil, fmt.Errorf("districts.png has %d colours, at most 65535 districts", len(colours))
	}

	fillBlankDistricts(ids, w4, h4)
	if split := splitDistricts(ids, w4, h4, len(colours)); len(split) > 0 {
		names := make([]string, len(split))
		for i, id := range split {
			names[i] = fmt.Sprintf("#%06x", colours[id])
		}
		LoggerFromContext(ctx).Warn(fmt.Sprintf("districts.png: these districts are in more than one piece: %s", strings.Join(names, ", ")))
	}

	rows := make([]string, h4)
	for y := 0; y < h4; y++ {
		var b strings.Builder
		row := ids[y*w4 : (y+1)*w4]
		for x := 0; x < w4; {
			end := x + 1
			for end < w4 && row[end] == row[x] {
				end++
			}
			if b.Len() > 0 {
				b.WriteByte(' ')
			}
			b.WriteString(strconv.Itoa(row[x]))
			b.WriteByte('*')
			b.WriteString(strconv.Itoa(end - x))
			x = end
		}
		rows[y] = b.String()
	}
	return map[string]interface{}{
		"count": len(colours),
		"rows":  rows,
	}, nil
}

// fillBlankDistricts gives each blank (-1) cell the district of the nearest
// painted one, growing out from the painted cells a ring at a time.
func fillBlankDistricts(ids []int, w, h int) {
	queue := make([]int, 0, len(ids))
	for c, id := range ids {
		if id >= 0 {
			queue = append(queue, c)
		}
	}
	for head := 0; head < len(queue); head++ {
		c := queue[head]
		x, y := c%w, c/w
		for _, n := range [4][2]int{{x, y - 1}, {x - 1, y}, {x + 1, y}, {x, y + 1}} {
			if n[0] < 0 || n[0] >= w || n[1] < 0 || n[1] >= h {
				continue
			}
			nc := n[1]*w + n[0]
			if ids[nc] < 0 {
				ids[nc] = ids[c]
				queue = append(queue, nc)
			}
		}
	}
}

// splitDistricts lists the districts whose cells form more than one
// 4-connected piece, in id order.
func splitDistricts(ids []int, w, h, count int) []int {
	pieces := make([]int, count)
	seen := make([]bool, len(ids))
	var stack []int
	for start := range ids {
		if seen[start] {
			continue
		}
		id := ids[start]
		pieces[id]++
		seen[start] = true
		stack = append(stack[:0], start)
		for len(stack) > 0 {
			c := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			x, y := c%w, c/w
			for _, n := range [4][2]int{{x, y - 1}, {x - 1, y}, {x + 1, y}, {x, y + 1}} {
				if n[0] < 0 || n[0] >= w || n[1] < 0 || n[1] >= h {
					continue
				}
				nc := n[1]*w + n[0]
				if !seen[nc] && ids[nc] == id {
					seen[nc] = true
					stack = append(stack, nc)
				}
			}
		}
	}
	var split []int
	for id, n := range pieces {
		if n > 1 {
			split = append(split, id)
		}
	}
	return split
}
