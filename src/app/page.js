"use client";

import {
  useState,
  useEffect,
  useRef,
} from "react";

import { supabase } from "../lib/supabase";

export default function Home() {
  const GRID_SIZE = 50;

  // -----------------------------------
  // USERNAME SYSTEM
  // -----------------------------------
  const [username, setUsername] =
    useState("Loading...");

  useEffect(() => {
    let saved =
      localStorage.getItem("username");

    if (!saved) {
      saved =
        "Guest" +
        Math.floor(
          1000 + Math.random() * 9000
        );

      localStorage.setItem(
        "username",
        saved
      );
    }

    setUsername(saved);
  }, []);

  // -----------------------------------
  // CREDITS
  // -----------------------------------
  const [credits, setCredits] =
    useState(100);

  // -----------------------------------
  // STATES
  // -----------------------------------
  const [squares, setSquares] = useState(
    Array(GRID_SIZE * GRID_SIZE).fill({
      color: "#ffffff",
      username: "",
    })
  );

  const [selectedColor, setSelectedColor] =
    useState("#ff0000");

  const [hoveredSquare, setHoveredSquare] =
    useState(null);

  const [tool, setTool] =
    useState("brush");

  const [isDrawing, setIsDrawing] =
    useState(false);

  const [scale, setScale] = useState(1);

  const [offset, setOffset] = useState({
    x: 0,
    y: 0,
  });

  const [isPanning, setIsPanning] =
    useState(false);

  const panStart = useRef({
    x: 0,
    y: 0,
  });

  const hasLoaded = useRef(false);

  // -----------------------------------
  // LOAD CANVAS
  // -----------------------------------
  const loadCanvas = async () => {
    const { data, error } = await supabase
      .from("squares")
      .select("*");

    if (error) {
      console.log(error);
      return;
    }

    const grid = Array(
      GRID_SIZE * GRID_SIZE
    ).fill({
      color: "#ffffff",
      username: "",
    });

    data.forEach((item) => {
      const index =
        (item.y - 1) * GRID_SIZE +
        (item.x - 1);

      if (
        index >= 0 &&
        index < grid.length
      ) {
        grid[index] = {
          color: item.color,
          username:
            item.username || "",
        };
      }
    });

    setSquares(grid);
  };

  // -----------------------------------
  // INITIAL LOAD
  // -----------------------------------
  useEffect(() => {
    loadCanvas();
  }, []);

  // -----------------------------------
  // REALTIME
  // -----------------------------------
  useEffect(() => {
    let channel;

    const initRealtime = async () => {
      if (hasLoaded.current) return;

      hasLoaded.current = true;

      await loadCanvas();

      channel = supabase
        .channel("squares-live")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "squares",
          },
          (payload) => {
            const row = payload.new;

            if (!row) return;

            const index =
              (row.y - 1) * GRID_SIZE +
              (row.x - 1);

            setSquares((prev) => {
              const updated = [...prev];

              updated[index] = {
                color: row.color,
                username:
                  row.username || "",
              };

              return updated;
            });
          }
        )
        .subscribe();
    };

    initRealtime();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  // -----------------------------------
  // PAINT PIXEL
  // -----------------------------------
  const paintPixel = async (
    x,
    y,
    i
  ) => {
    const pixel = squares[i];

    // -----------------------------------
    // BRUSH TOOL
    // -----------------------------------
    if (tool === "brush") {
      // owned by someone else
      if (
        pixel.color !== "#ffffff" &&
        pixel.username !== username
      ) {
        return;
      }

      const isNewClaim =
        pixel.color === "#ffffff";

      // STOP if no credits
      if (
        isNewClaim &&
        credits <= 0
      ) {
        return;
      }

      // SAME COLOR
      if (
        pixel.color ===
          selectedColor &&
        pixel.username === username
      ) {
        return;
      }

      // FINAL SAFETY
      if (
        isNewClaim &&
        credits - 1 < 0
      ) {
        return;
      }

      const updated = [...squares];

      updated[i] = {
        color: selectedColor,
        username,
      };

      setSquares(updated);

      // ONLY CHARGE NEW CLAIMS
      if (isNewClaim) {
        setCredits((prev) =>
          Math.max(prev - 1, 0)
        );
      }

      await supabase
        .from("squares")
        .upsert(
          {
            x,
            y,
            color: selectedColor,
            username,
          },
          {
            onConflict: "x,y",
          }
        );
    }

    // -----------------------------------
    // ERASER TOOL
    // -----------------------------------
    if (tool === "eraser") {
      // only owner can erase
      if (
        pixel.username !== username
      ) {
        return;
      }

      // already empty
      if (
        pixel.color === "#ffffff"
      ) {
        return;
      }

      const updated = [...squares];

      updated[i] = {
        color: "#ffffff",
        username: "",
      };

      setSquares(updated);

      // REFUND CREDIT
      setCredits((prev) => prev + 1);

      await supabase
        .from("squares")
        .upsert(
          {
            x,
            y,
            color: "#ffffff",
            username: "",
          },
          {
            onConflict: "x,y",
          }
        );
    }
  };

  // -----------------------------------
  // TOUCH SUPPORT
  // -----------------------------------
  const handleTouchMove = (e) => {
    if (!isDrawing) return;

    const touch =
      e.touches[0];

    if (!touch) return;

    const element =
      document.elementFromPoint(
        touch.clientX,
        touch.clientY
      );

    if (
      !element ||
      !element.dataset.index
    )
      return;

    const i = Number(
      element.dataset.index
    );

    const x =
      (i % GRID_SIZE) + 1;

    const y =
      Math.floor(i / GRID_SIZE) +
      1;

    paintPixel(x, y, i);
  };

  // -----------------------------------
  // ZOOM
  // -----------------------------------
  const handleWheel = (e) => {
    e.preventDefault();

    const zoomSpeed = 0.1;

    if (e.deltaY < 0) {
      setScale((prev) =>
        Math.min(prev + zoomSpeed, 4)
      );
    } else {
      setScale((prev) =>
        Math.max(prev - zoomSpeed, 0.5)
      );
    }
  };

  // -----------------------------------
  // PAN START
  // -----------------------------------
  const startPan = (e) => {
    if (e.button !== 1) return;

    setIsPanning(true);

    panStart.current = {
      x: e.clientX - offset.x,
      y: e.clientY - offset.y,
    };
  };

  // -----------------------------------
  // PAN MOVE
  // -----------------------------------
  const movePan = (e) => {
    if (!isPanning) return;

    setOffset({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
    });
  };

  // -----------------------------------
  // PAN END
  // -----------------------------------
  const endPan = () => {
    setIsPanning(false);
  };

  // -----------------------------------
  // FAKE BUY CREDITS
  // -----------------------------------
  const buyCredits = () => {
    setCredits((prev) => prev + 100);

    alert(
      "Fake payment successful.\n+100 Pixel Credits"
    );
  };

  return (
    <main
      className="w-screen h-screen overflow-hidden bg-gray-100 touch-none"
      onMouseMove={movePan}
      onMouseUp={() => {
        setIsDrawing(false);
        endPan();
      }}
      onTouchEnd={() =>
        setIsDrawing(false)
      }
      onTouchMove={
        handleTouchMove
      }
      onWheel={handleWheel}
    >
      {/* UI */}
      <div className="fixed top-4 left-4 z-50 bg-white p-4 rounded shadow flex gap-4 items-center flex-wrap max-w-[95vw]">
        <h1 className="font-bold text-xl">
          The Great Canvas
        </h1>

        <p>
          You:{" "}
          <span className="font-bold">
            {username}
          </span>
        </p>

        <p className="font-bold text-green-600">
          Credits: {credits}
        </p>

        <button
          className="bg-black text-white px-4 py-2 rounded"
          onClick={buyCredits}
        >
          Buy 100 Credits ($1)
        </button>

        {/* COLOR PICKER */}
        <input
          type="color"
          value={selectedColor}
          disabled={credits <= 0}
          onChange={(e) =>
            setSelectedColor(
              e.target.value
            )
          }
        />

        {/* BRUSH */}
        <button
          className={`px-4 py-2 rounded border ${
            tool === "brush"
              ? "bg-black text-white"
              : "bg-white"
          }`}
          disabled={credits <= 0}
          onClick={() =>
            setTool("brush")
          }
        >
          Brush
        </button>

        {/* ERASER */}
        <button
          className={`px-4 py-2 rounded border ${
            tool === "eraser"
              ? "bg-black text-white"
              : "bg-white"
          }`}
          onClick={() =>
            setTool("eraser")
          }
        >
          Eraser
        </button>

        <div>
          <p>
            Hover: (
            {hoveredSquare?.x},{" "}
            {hoveredSquare?.y})
          </p>

          <p>
            Owner:{" "}
            {
              hoveredSquare?.username
            }
          </p>
        </div>

        <p>
          Zoom: {scale.toFixed(1)}x
        </p>
      </div>

      {/* CANVAS */}
      <div
        className="absolute"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div className="grid grid-cols-50 w-fit">
          {squares.map((square, i) => {
            const x =
              (i % GRID_SIZE) + 1;

            const y =
              Math.floor(i / GRID_SIZE) +
              1;

            const ownedByOther =
              square.color !==
                "#ffffff" &&
              square.username !==
                username;

            return (
              <div
                key={i}
                data-index={i}
                className={`w-5 h-5 border ${
                  ownedByOther
                    ? "cursor-not-allowed"
                    : "cursor-crosshair"
                }`}
                style={{
                  backgroundColor:
                    square.color,
                }}
                onMouseEnter={() => {
                  setHoveredSquare({
                    x,
                    y,
                    username:
                      square.username,
                  });

                  if (isDrawing) {
                    paintPixel(
                      x,
                      y,
                      i
                    );
                  }
                }}
                onMouseDown={(e) => {
                  // LEFT CLICK = DRAW
                  if (e.button === 0) {
                    setIsDrawing(true);

                    paintPixel(
                      x,
                      y,
                      i
                    );
                  }

                  // MIDDLE CLICK = PAN
                  if (e.button === 1) {
                    startPan(e);
                  }
                }}
                onTouchStart={() => {
                  setIsDrawing(true);

                  paintPixel(
                    x,
                    y,
                    i
                  );
                }}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}