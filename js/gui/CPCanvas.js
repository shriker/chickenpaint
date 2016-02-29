function CPCanvas(controller) {
    "use strict";
    
    var
        BUTTON_PRIMARY = 0,
        BUTTON_SECONDARY = 1,
        BUTTON_WHEEL = 2,
        
        that = this,
    
        container = document.createElement("div"),
        canvas = document.createElement("canvas"),
        
        canvasContext = canvas.getContext("2d"),
        
        artworkCanvas = document.createElement("canvas"),
        artworkCanvasContext = artworkCanvas.getContext("2d"),
        
        checkerboardPattern = createCheckerboardPattern(),
        
        artwork = controller.getArtwork(),

        spacePressed = false,
        
        // canvas transformations
        zoom = 1, minZoom = 0.05, maxZoom = 16.0,
        offsetX = 0, offsetY = 0,
        canvasRotation = 0.0,
        transform = new CPTransform(),
        interpolation = false,
        
        showGrid = false,
        
        mouseX = 0, mouseY = 0,
        
        brushPreview = false,
        oldPreviewRect = null,
        
        defaultCursor = "auto", moveCursor = "grabbing", crossCursor = "crosshair",
        mouseIn = false, mouseDown = false,
        
        dontStealFocus = false,
        
        /* The area of the document that should have its layers fused and repainted to the screen
         * (i.e. an area modified by drawing tools). 
         * 
         * Initially set to the size of the artwork so we can repaint the whole thing.
         */
        updateRegion = new CPRect(0, 0, artwork.width, artwork.height),
        
        //
        // Modes system: modes control the way the GUI is reacting to the user input
        // All the tools are implemented through modes
        //
        
        defaultMode,
        colorPickerMode,
        moveCanvasMode,
        rotateCanvasMode,
        floodFillMode,
        rectSelectionMode,
        moveToolMode,

        // this must correspond to the stroke modes defined in CPToolInfo
        drawingModes = [],

        curDrawMode, curSelectedMode, activeMode;

    // Parent class with empty event handlers for those drawing modes that don't need every event
    function CPDrawingMode() {
    };
    
    CPDrawingMode.prototype.mouseMoved = CPDrawingMode.prototype.paint = CPDrawingMode.prototype.mousePressed 
        = CPDrawingMode.prototype.mouseDragged = CPDrawingMode.prototype.mouseReleased = function() {};
    
    //
    // Default UI Mode when not doing anything: used to start the other modes
    //

    function CPDefaultMode() {
    }
    
    CPDefaultMode.prototype = Object.create(CPDrawingMode.prototype);
    CPDefaultMode.prototype.constructor = CPDefaultMode;
    
    CPDefaultMode.prototype.mousePressed = function(e) {
        // FIXME: replace the moveToolMode hack by a new and improved system
        if (!spacePressed && e.button == BUTTON_PRIMARY
                && (!e.altKey || curSelectedMode == moveToolMode)) {

            if (!artwork.getActiveLayer().visible && curSelectedMode != rotateCanvasMode
                    && curSelectedMode != rectSelectionMode) {
                return; // don't draw on a hidden layer
            }
            repaintBrushPreview();

            activeMode = curSelectedMode;
            activeMode.mousePressed(e);
        } else if (!spacePressed
                && (e.button == BUTTON_SECONDARY || e.button == BUTTON_PRIMARY && e.altKey)) {
            repaintBrushPreview();

            activeMode = colorPickerMode;
            activeMode.mousePressed(e);
        } else if ((e.button == BUTTON_WHEEL || spacePressed) && !e.altKey) {
            repaintBrushPreview();

            activeMode = moveCanvasMode;
            activeMode.mousePressed(e);
        } else if ((e.button == BUTTON_WHEEL || spacePressed) && e.altKey) {
            repaintBrushPreview();

            activeMode = rotateCanvasMode;
            activeMode.mousePressed(e);
        }
    };

    CPDefaultMode.prototype.mouseMoved = function(e) {
        if (!spacePressed && curSelectedMode == curDrawMode) {
            brushPreview = true;

            var 
                pf = coordToDocument({x: e.pageX, y: e.pageY}),
                r = getBrushPreviewOval();
            
            r.grow(2, 2);
            
            // If a brush preview was drawn previously, stretch the repaint region to remove that old copy
            if (oldPreviewRect != null) {
                r.union(oldPreviewRect);
                oldPreviewRect = null;
            }
            
            if (artwork.isPointWithin(pf.x, pf.y)) {
                setCursor(defaultCursor); // FIXME find a cursor that everyone likes
            } else {
                setCursor(defaultCursor);
            }

            repaintRect(r);
        }
    };
    
    CPDefaultMode.prototype.paint = function() {
        if (brushPreview && curSelectedMode == curDrawMode) {
            brushPreview = false;

            var
                r = getBrushPreviewOval();
            
            canvasContext.beginPath();
            canvasContext.arc((r.left + r.right) / 2, (r.top + r.bottom) / 2, r.getWidth() / 2, 0, Math.PI * 2);
            canvasContext.stroke();

            r.grow(2, 2);
            oldPreviewRect = oldPreviewRect != null ? r.union(oldPreviewRect) : r;
        }
    };

    function CPFreehandMode() {
        this.dragLeft = false,
        this.smoothMouse = {x:0.0, y:0.0};
    }
    
    CPFreehandMode.prototype.mousePressed = function(e) {
        if (!this.dragLeft && e.button == BUTTON_PRIMARY) {
            var 
                pf = coordToDocument({x: e.pageX, y: e.pageY});

            this.dragLeft = true;
            artwork.beginStroke(pf.x, pf.y, CPTablet.getRef().getPressure());

            this.smoothMouse = pf;
        }
    };

    CPFreehandMode.prototype.mouseDragged = function(e) {
        var 
            pf = coordToDocument({x: e.pageX, y: e.pageY}),
            smoothing = Math.min(0.999, Math.pow(controller.getBrushInfo().smoothing, 0.3));

        this.smoothMouse.x = (1.0 - smoothing) * pf.x + smoothing * this.smoothMouse.x;
        this.smoothMouse.y = (1.0 - smoothing) * pf.y + smoothing * this.smoothMouse.y;

        if (this.dragLeft) {
            artwork.continueStroke(this.smoothMouse.x, this.smoothMouse.y, CPTablet.getRef().getPressure());
        }
    };

    CPFreehandMode.prototype.mouseReleased = function(e) {
        if (this.dragLeft && e.button == BUTTON_PRIMARY) {
            this.dragLeft = false;
            artwork.endStroke();

            activeMode = defaultMode; // yield control to the default mode
        }
    };
        
    CPFreehandMode.prototype.mouseMoved = CPFreehandMode.prototype.paint = function(e) {
    };

    // TODO
    
    function CPBezierMode() {}
    function CPMoveCanvasMode() {}
    function CPFloodFillMode() {}
    function CPRectSelectionMode() {}
    function CPMoveToolMode() {}
    function CPRotateCanvasMode() {}
    
    function CPLineMode() {
        var
            dragLine = false,
            dragLineFrom, dragLineTo,
            LINE_PREVIEW_WIDTH = 1;

        this.mousePressed = function(e) {
            if (!dragLine && e.button == BUTTON_PRIMARY) {
                dragLine = true;
                dragLineFrom = dragLineTo = coordToDocument({x: e.pageX, y: e.pageY});
            }
        };

        this.mouseDragged = function(e) {
            var
                p = coordToDocument({x: e.pageX, y: e.pageY}),

                // The old line position that we'll invalidate for redraw
                r = new CPRect(
                    Math.min(dragLineFrom.x, dragLineTo.x) - LINE_PREVIEW_WIDTH, 
                    Math.min(dragLineFrom.y, dragLineTo.y) - LINE_PREVIEW_WIDTH,
                    Math.max(dragLineFrom.x, dragLineTo.x) + LINE_PREVIEW_WIDTH + 1, 
                    Math.max(dragLineFrom.y, dragLineTo.y) + LINE_PREVIEW_WIDTH + 1
                );
                
            // The new line position
            r.union(new CPRect(
                Math.min(dragLineFrom.x, p.x) - LINE_PREVIEW_WIDTH, 
                Math.min(dragLineFrom.y, p.y) - LINE_PREVIEW_WIDTH, 
                Math.max(dragLineFrom.x, p.x) + LINE_PREVIEW_WIDTH + 1, 
                Math.max(dragLineFrom.y, p.y) + LINE_PREVIEW_WIDTH + 1
            ));
            
            dragLineTo = p;
            
            repaintRect(r);
        };

        this.mouseReleased = function(e) {
            if (dragLine && e.button == BUTTON_PRIMARY) {
                var 
                    pf = coordToDocument({x: e.pageX, y: e.pageY}),
                    from = dragLineFrom;

                dragLine = false;

                artwork.beginStroke(from.x, from.y, 1);
                artwork.continueStroke(pf.x, pf.y, 1);
                artwork.endStroke();

                var
                    r = new CPRect(
                        Math.min(dragLineFrom.x, dragLineTo.x) - LINE_PREVIEW_WIDTH, 
                        Math.min(dragLineFrom.y, dragLineTo.y) - LINE_PREVIEW_WIDTH, 
                        Math.max(dragLineFrom.x, dragLineTo.x) + LINE_PREVIEW_WIDTH + 1, 
                        Math.max(dragLineFrom.y, dragLineTo.y) + LINE_PREVIEW_WIDTH + 1
                    );
                
                repaintRect(r);

                activeMode = defaultMode; // yield control to the default mode
            }
        };

        this.paint = function() {
            if (dragLine) {
                canvasContext.strokeWidth = LINE_PREVIEW_WIDTH;
                canvasContext.beginPath();
                canvasContext.moveTo(dragLineFrom.x, dragLineFrom.y);
                canvasContext.lineTo(dragLineTo.x, dragLineTo.y);
                canvasContext.stroke();
            }
        };
    }

    /*
    function CPBezierMode() {
        var 
            BEZIER_POINTS = 500,
            BEZIER_POINTS_PREVIEW = 100,

            dragBezier = false,
            dragBezierMode = 0, // 0 Initial drag, 1 first control point, 2 second point
            dragBezierP0, dragBezierP1, dragBezierP2, dragBezierP3;

        this.mousePressed = function(e) {
            Point2D.Float p = coordToDocument({x: e.pageX, y: e.pageY});

            if (!dragBezier && !spacePressed && e.button == BUTTON_PRIMARY) {
                dragBezier = true;
                dragBezierMode = 0;
                dragBezierP0 = dragBezierP1 = dragBezierP2 = dragBezierP3 = (Point2D.Float) p.clone();
            }
        }

        this.mouseDragged = function(e) {
            Point2D.Float p = coordToDocument({x: e.pageX, y: e.pageY});

            if (dragBezier && dragBezierMode == 0) {
                dragBezierP2 = dragBezierP3 = (Point2D.Float) p.clone();
                that.repaintAll();
            }
        }

        this.mouseReleased = function(e) {
            if (dragBezier && e.button == BUTTON_PRIMARY) {
                if (dragBezierMode == 0) {
                    dragBezierMode = 1;
                } else if (dragBezierMode == 1) {
                    dragBezierMode = 2;
                } else if (dragBezierMode == 2) {
                    dragBezier = false;

                    Point2D.Float p0 = dragBezierP0;
                    Point2D.Float p1 = dragBezierP1;
                    Point2D.Float p2 = dragBezierP2;
                    Point2D.Float p3 = dragBezierP3;

                    CPBezier bezier = new CPBezier();
                    bezier.x0 = p0.x;
                    bezier.y0 = p0.y;
                    bezier.x1 = p1.x;
                    bezier.y1 = p1.y;
                    bezier.x2 = p2.x;
                    bezier.y2 = p2.y;
                    bezier.x3 = p3.x;
                    bezier.y3 = p3.y;

                    float x[] = new float[BEZIER_POINTS];
                    float y[] = new float[BEZIER_POINTS];

                    bezier.compute(x, y, BEZIER_POINTS);

                    artwork.beginStroke(x[0], y[0], 1);
                    for (int i = 1; i < BEZIER_POINTS; i++) {
                        artwork.continueStroke(x[i], y[i], 1);
                    }
                    artwork.endStroke();
                    that.repaintAll();

                    activeMode = defaultMode; // yield control to the default mode
                }
            }
        }

        this.mouseMoved = function(e) {
            Point2D.Float p = coordToDocument({x: e.pageX, y: e.pageY});

            if (dragBezier && dragBezierMode == 1) {
                dragBezierP1 = (Point2D.Float) p.clone();
                that.repaintAll(); // FIXME: repaint only the bezier region
            }

            if (dragBezier && dragBezierMode == 2) {
                dragBezierP2 = (Point2D.Float) p.clone();
                that.repaintAll(); // FIXME: repaint only the bezier region
            }
        }

        this.paint = function() {
            if (dragBezier) {
                CPBezier bezier = new CPBezier();

                Point2D.Float p0 = coordToDisplay(dragBezierP0);
                Point2D.Float p1 = coordToDisplay(dragBezierP1);
                Point2D.Float p2 = coordToDisplay(dragBezierP2);
                Point2D.Float p3 = coordToDisplay(dragBezierP3);

                bezier.x0 = p0.x;
                bezier.y0 = p0.y;
                bezier.x1 = p1.x;
                bezier.y1 = p1.y;
                bezier.x2 = p2.x;
                bezier.y2 = p2.y;
                bezier.x3 = p3.x;
                bezier.y3 = p3.y;

                int x[] = new int[BEZIER_POINTS_PREVIEW];
                int y[] = new int[BEZIER_POINTS_PREVIEW];
                bezier.compute(x, y, BEZIER_POINTS_PREVIEW);

                g2d.drawPolyline(x, y, BEZIER_POINTS_PREVIEW);
                g2d.drawLine((int) p0.x, (int) p0.y, (int) p1.x, (int) p1.y);
                g2d.drawLine((int) p2.x, (int) p2.y, (int) p3.x, (int) p3.y);
            }
        }
    }*/

    function CPColorPickerMode() {
        var 
            mouseButton;

        this.mousePressed = function(e) {
            mouseButton = e.button;

            setCursor(crossCursor);
            
            this.mouseDragged(e);
        };

        this.mouseDragged = function(e) {
            var pf = coordToDocument({x: e.pageX, y: e.pageY});

            if (artwork.isPointWithin(pf.x, pf.y)) {
                controller.setCurColorRgb(artwork.colorPicker(pf.x, pf.y));
            }
        };

        this.mouseReleased = function(e) {
            if (e.button == mouseButton) {
                setCursor(defaultCursor);
                activeMode = defaultMode; // yield control to the default mode
            }
        };
    }
    
    CPColorPickerMode.prototype = Object.create(CPDrawingMode.prototype);
    CPColorPickerMode.prototype.constructor = CPColorPickerMode;

    /*function CPMoveCanvasMode() {
        var
            dragMiddle = false,
            dragMoveX, dragMoveY,
            dragMoveOffset,
            dragMoveButton;

        this.mousePressed = function (e) {
            var
                p = {x: e.pageX, y: e.pageY};

            if (!dragMiddle && (e.button == BUTTON_WHEEL || spacePressed)) {
                repaintBrushPreview();

                dragMiddle = true;
                dragMoveButton = e.button;
                dragMoveX = p.x;
                dragMoveY = p.y;
                dragMoveOffset = getOffset();
                setCursor(moveCursor);
            }
        }

        this.mouseDragged = function (e) {
            if (dragMiddle) {
                Point p = {x: e.pageX, y: e.pageY};

                setOffset(dragMoveOffset.x + p.x - dragMoveX, offsetY = dragMoveOffset.y + p.y - dragMoveY);
                that.repaintAll();
            }
        }

        this.mouseReleased = function (e) {
            if (dragMiddle && e.button == dragMoveButton) {
                dragMiddle = false;
                setCursor(defaultCursor);

                activeMode = defaultMode; // yield control to the default mode
            }
        }
    }*/

    function CPFloodFillMode() {
    }
    
    CPFloodFillMode.prototype = Object.create(CPDrawingMode.prototype);
    CPFloodFillMode.prototype.constructor = CPFloodFillMode;

    CPFloodFillMode.prototype.mousePressed = function(e) {
        var 
            pf = coordToDocument({x: e.pageX, y: e.pageY});
    
        if (artwork.isPointWithin(pf.x, pf.y)) {
            artwork.floodFill(pf.x, pf.y);
            that.repaintAll();
        }
    
        activeMode = defaultMode; // yield control to the default mode
    };

    function CPRectSelectionMode() {
        var
            firstClick,
            curRect = new CPRect();

        this.mousePressed = function (e) {
            var
                p = coordToDocument({x: e.pageX, y: e.pageY});

            curRect.makeEmpty();
            firstClick = p;

            that.repaintAll();
        };

        this.mouseDragged = function(e) {
            var
                p = coordToDocument({x: e.pageX, y: e.pageY}),
                square = e.shiftKey,
                
                squareDist = ~~Math.max(Math.abs(p.x - firstClick.x), Math.abs(p.y - firstClick.y));

            if (p.x >= firstClick.x) {
                curRect.left = firstClick.x;
                curRect.right = square ? firstClick.x + squareDist : p.x;
            } else {
                curRect.left = square ? firstClick.x - squareDist : p.x;
                curRect.right = firstClick.x;
            }

            if (p.y >= firstClick.y) {
                curRect.top = firstClick.y;
                curRect.bottom = square ? firstClick.y + squareDist : p.y;
            } else {
                curRect.top = square ? firstClick.y - squareDist : p.y;
                curRect.bottom = firstClick.y;
            }

            that.repaintAll();
        };

        this.mouseReleased = function (e) {
            artwork.rectangleSelection(curRect);
            curRect.makeEmpty();
            
            activeMode = defaultMode; // yield control to the default mode
            that.repaintAll();
        };

        this.paint = function() {
            if (!curRect.isEmpty()) {
                canvasContext.beginPath();
                canvasContext.rect(curRect.left + 0.5, curRect.top + 0.5, curRect.getWidth(), curRect.getHeight());
                canvasContext.stroke();
            }
        };
    };

    /*function CPMoveToolMode() {

        var firstClick;

        this.mousePressed = function (e) {
            Point p = coordToDocumentInt({x: e.pageX, y: e.pageY});
            firstClick = p;

            artwork.beginPreviewMode(e.isAltDown());

            // FIXME: The following hack avoids a slight display glitch
            // if the whole move tool mess is fixed it probably won't be necessary anymore
            artwork.move(0, 0);
        }

        this.mouseDragged = function (e) {
            Point p = coordToDocumentInt({x: e.pageX, y: e.pageY});
            artwork.move(p.x - firstClick.x, p.y - firstClick.y);
            that.repaintAll();
        }

        this.mouseReleased = function (e) {
            artwork.endPreviewMode();
            activeMode = defaultMode; // yield control to the default mode
            that.repaintAll();
        }
    }

    function CPRotateCanvasMode() {

        var 
            firstClick,
            initAngle = 0.0,
            initTransform,
            dragged = false;

        this.mousePressed = function (e) {
            Point p = {x: e.pageX, y: e.pageY};
            firstClick = (Point) p.clone();

            initAngle = getRotation();
            initTransform = new AffineTransform(transform);

            dragged = false;

            repaintBrushPreview();
        }

        this.mouseDragged = function (e) {
            dragged = true;

            Point p = {x: e.pageX, y: e.pageY};
            Dimension d = getSize();
            Point2D.Float center = new Point2D.Float(d.width / 2.f, d.height / 2.f);

            float deltaAngle = (float) Math.atan2(p.y - center.y, p.x - center.x)
                    - (float) Math.atan2(firstClick.y - center.y, firstClick.x - center.x);

            AffineTransform rotTrans = new AffineTransform();
            rotTrans.rotate(deltaAngle, center.x, center.y);

            rotTrans.concatenate(initTransform);

            setRotation(initAngle + deltaAngle);
            setOffset((int) rotTrans.getTranslateX(), (int) rotTrans.getTranslateY());
            that.repaintAll();
        }

        /**
         * When the mouse is released after rotation, we might want to snap our angle to the nearest 90 degree mark.
         *//*
        private void finishRotation() {
            double ROTATE_SNAP_DEGREES = 5;
            
            double nearest90 = Math.round(canvasRotation / (Math.PI / 2)) * Math.PI / 2;
            
            if (Math.abs(canvasRotation - nearest90) < ROTATE_SNAP_DEGREES / 180 * Math.PI) {
                float deltaAngle = (float) (nearest90 - initAngle);
                
                Dimension d = getSize();
                
                Point2D.Float center = new Point2D.Float(d.width / 2.f, d.height / 2.f);

                AffineTransform rotTrans = new AffineTransform();
                rotTrans.rotate(deltaAngle, center.x, center.y);

                rotTrans.concatenate(initTransform);

                setRotation(initAngle + deltaAngle);
                setOffset((int) rotTrans.getTranslateX(), (int) rotTrans.getTranslateY());
                
                that.repaintAll();
            }
        }
        
        this.mouseReleased= function (e) {
            if (dragged) {
                finishRotation();
            } else {
                resetRotation();
            }

            activeMode = defaultMode; // yield control to the default mode
        }
    }*/
    
    // Grid options
    // FIXME: these shouldn't be public
    this.gridSize = 32;
    
    function requestFocusInWindow() {
        // TODO
    }
    
    function setCursor(cursor) {
        canvas.style.cursor = cursor;
    }
    
    /**
     * Schedule a repaint for an area of the screen for later.
     * 
     * @param rect CPRect Region that should be repainted using display coordinates
     */
    function repaintRect(rect) {
        //TODO schedule a repaint using requestanimationframe()

        canvasContext.save();
        
        canvasContext.beginPath();
        canvasContext.rect(rect.left, rect.top, rect.getWidth(), rect.getHeight());
        canvasContext.clip();
        
        that.paint();
        
        canvasContext.restore();
    };
    
    function updateScrollBars() {
        //TODO
    }

    function updateTransform() {
        transform.setToIdentity();
        transform.translate(offsetX, offsetY);
        transform.scale(zoom, zoom);
        transform.rotate(canvasRotation);

        updateScrollBars();
        that.repaintAll();
    }
    
    function rectToDisplay(rect) {
        var
            points = [];

        points.push(coordToDisplayInt({x: r.left, y: r.top}));
        points.push(coordToDisplayInt({x: r.right - 1, y: r.top}));
        points.push(coordToDisplayInt({x: r.right - 1, y: r.bottom - 1}));
        points.push(coordToDisplayInt({x: r.left, y: r.bottom - 1}));
        
        return points;
    }
    
    /**
     * Convert an {x: pageX, y: pageY} pair from a mouse event into document coordinates.
     */
    function coordToDocument(coord) {
        var
            canvasOffset =  $(canvas).offset();
    
        return transform.getInverted().transformPoint(coord.x - canvasOffset.left, coord.y - canvasOffset.top);
    }
    
    function coordToDisplay(p) {
        return transform.transformPoint(p.x, p.y);
    }

    function coordToDisplayInt(p) {
        var
            result = coordToDisplay(p);
        
        result.x = result.x | 0;
        result.y = result.y | 0;
        
        return result;
    }
    
    function getRefreshArea(r) {
        var
            p1 = coordToDisplay({x: r.left - 1, y: r.top - 1}),
            p2 = coordToDisplay({x: r.left - 1, y: r.bottom}),
            p3 = coordToDisplay({x: r.right, y: r.top - 1}),
            p4 = coordToDisplay({x: r.right, y: r.bottom}),

            r2 = new CPRect();

        r2.left = Math.min(Math.min(p1.x, p2.x), Math.min(p3.x, p4.x));
        r2.top = Math.min(Math.min(p1.y, p2.y), Math.min(p3.y, p4.y));
        r2.right = Math.max(Math.max(p1.x, p2.x), Math.max(p3.x, p4.x)) + 1;
        r2.bottom = Math.max(Math.max(p1.y, p2.y), Math.max(p3.y, p4.y)) + 1;

        r2.grow(2, 2); // to be sure to include everything

        return r2;
    }
    
    function repaintBrushPreview() {
        if (oldPreviewRect != null) {
            var r = oldPreviewRect;
            oldPreviewRect = null;
            repaintRect(r);
        }
    }

    /**
     * Get a rectangle that encloses the preview brush, in screen coordinates.
     */
    function getBrushPreviewOval() {
        var brushSize = ~~(controller.getBrushSize() * zoom);
        
        return new CPRect(
            mouseX - brushSize / 2, 
            mouseY - brushSize / 2, 
            mouseX + brushSize / 2, 
            mouseY + brushSize / 2
        );
    }

    /**
     * Adjust the current offset to bring the center of the artwork to the center of the canvas
     */
    function centerCanvas() {
        var
            width = canvas.width,
            height = canvas.height,
        
            artworkCenter = coordToDisplay({x: artwork.width / 2, y: artwork.height / 2});
        
        that.setOffset(
            Math.round(offsetX + width / 2.0 - artworkCenter.x),
            Math.round(offsetY + height / 2.0 - artworkCenter.y)
        );
    }
    
    this.setZoom = function(_zoom) {
        zoom = _zoom;
        updateTransform();
    };

    this.getZoom = function() {
        return zoom;
    };

    this.setOffset = function(x, y) {
        offsetX = x;
        offsetY = y;
        updateTransform();
    };

    this.getOffset = function() {
        return {x: offsetX, y: offsetY};
    }

    this.setRotation = function(angle) {
        canvasRotation = angle % (2 * Math.PI);
        updateTransform();
    };

    /**
     * Get canvas rotation in radians.
     * 
     * @return float
     */
    this.getRotation = function() {
        return canvasRotation;
    };
    
    function zoomOnPoint(zoom, centerX, centerY) {
        zoom = Math.max(minZoom, Math.min(maxZoom, zoom));
        
        if (that.getZoom() != zoom) {
            var 
                offset = that.getOffset();
            
            that.setOffset(
                offset.x + ~~((centerX - offset.x) * (1 - zoom / that.getZoom())), 
                offset.y + ~~((centerY - offset.y) * (1 - zoom / that.getZoom()))
            );
            
            that.setZoom(zoom);

            /*CPController.CPViewInfo viewInfo = new CPController.CPViewInfo();
            viewInfo.zoom = zoom;
            viewInfo.offsetX = offsetX;
            viewInfo.offsetY = offsetY;
            controller.callViewListeners(viewInfo); TODO */

            that.repaintAll();
        }
    }
    
    // More advanced zoom methods
    function zoomOnCenter(zoom) {
        var 
            width = $(canvas).width(),
            height = $(canvas).height()
            
        zoomOnPoint(zoom, width / 2, height / 2);
    }

    this.zoomIn = function() {
        zoomOnCenter(this.getZoom() * 2);
    };

    this.zoomOut = function() {
        zoomOnCenter(this.getZoom() * 0.5);
    };

    this.zoom100 = function() {
        zoomOnCenter(1);
        centerCanvas();
    };

    this.resetRotation = function() {
        var
            center = {x: canvas.width / 2, y: canvas.height / 2},

            rotTrans = new CPTransform();
        
        rotTrans.rotate(-this.getRotation(), center.x, center.y);
        rotTrans.concatenate(transform);

        this.setOffset(~~rotTrans.getTranslateX(), ~~rotTrans.getTranslateY());
        this.setRotation(0);
    };
    
    function createCheckerboardPattern() {
        var
            checkerboardCanvas = document.createElement("canvas"),
        
            checkerboardContext = checkerboardCanvas.getContext("2d"),
            imageData = checkerboardContext.createImageData(64, 64),
            data = imageData.data,
            pixelOffset = 0;
        
        for (var j = 0; j < 64; j++) {
            for (var i = 0; i < 64; i++) {
                if ((i & 0x8) != 0 ^ (j & 0x8) != 0) {
                    // White
                    data[pixelOffset++] = 0xff;
                    data[pixelOffset++] = 0xff;
                    data[pixelOffset++] = 0xff;
                    data[pixelOffset++] = 0xff;
                } else {
                    // Grey
                    data[pixelOffset++] = 0xcc;
                    data[pixelOffset++] = 0xcc;
                    data[pixelOffset++] = 0xcc;
                    data[pixelOffset++] = 0xff;
                }
            }
        }
        
        checkerboardCanvas.width = 64;
        checkerboardCanvas.height = 64;
        checkerboardContext.putImageData(imageData, 0, 0);
        
        return canvasContext.createPattern(checkerboardCanvas, 'repeat');
    }
    
    function handleMouseMove(e) {
        var
            offset = $(canvas).offset();
        
        mouseX = e.pageX - offset.left;
        mouseY = e.pageY - offset.top;
        
        if (!dontStealFocus) {
            requestFocusInWindow();
        }

        if (mouseDown) {
            activeMode.mouseDragged(e);
        } else {
            activeMode.mouseMoved(e);
        }
        
        CPTablet.getRef().mouseDetect();
    }
    
    function handleMouseUp(e) {
        mouseDown = false;
        activeMode.mouseReleased(e);
        
        window.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("mousemove", handleMouseMove);
        container.addEventListener("mousemove", handleMouseMove);
    }
    
    function handleMouseDown(e) {
        if (!mouseDown) {
            mouseDown = true;
            
            requestFocusInWindow();
            activeMode.mousePressed(e);
            
            window.addEventListener("mouseup", handleMouseUp);
            
            // Track the drag even if it leaves the canvas:
            container.removeEventListener("mousemove", handleMouseMove);
            window.addEventListener("mousemove", handleMouseMove);
        }
    }
    
    // Get the DOM element for the drawing area
    this.getElement = function() {
        return container;
    };
    
    this.repaintAll = function() {
        //TODO schedule a repaint using requestanimationframe()
        this.paint();
    };
    
    this.paint = function() {
        if (!updateRegion.isEmpty()) {
            var
                imageData = artwork.fusionLayers();
            
            artworkCanvasContext.putImageData(
                imageData, 0, 0, updateRegion.left, updateRegion.top, updateRegion.right - updateRegion.left, updateRegion.bottom - updateRegion.top
            );

            updateRegion.makeEmpty();
        }

        canvasContext.fillStyle = '#606060';
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);
        
        // Transform the coordinate system to bring the document into the right position on the screen (translate/zoom/etc)
        canvasContext.save();
        {
            canvasContext.setTransform(transform.m[0], transform.m[1], transform.m[2], transform.m[3], transform.m[4], transform.m[5]);
            
            canvasContext.fillStyle = checkerboardPattern;
            canvasContext.fillRect(0, 0, artwork.width, artwork.height);
            
            canvasContext.drawImage(
                artworkCanvas, 0, 0, artworkCanvas.width, artworkCanvas.height
            );
        }
        canvasContext.restore();
        
        // The rest of the drawing happens using the screen coordinate system
        
        // This XOR mode guarantees contrast over all colors
        canvasContext.globalCompositeOperation = 'exclusion';
        canvasContext.strokeStyle = 'white';
        canvasContext.lineWidth = 1.0;
        
        // Draw selection
        if (!artwork.getSelection().isEmpty()) {
            canvasContext.setLineDash([3, 2]);
            
            canvasContext.beginPath();
            
            var
                selectRect = coordToDisplay(artwork.getSelection());
            
            // Ensure the selection line fills a complete pixel by offsetting the midpoint to the middle of the pixel
            canvasContext.rect(selectRect.left + 0.5, selectRect.top + 0.5, selectRect.getWidth(), selectRect.getHeight());
            
            canvasContext.stroke();
            
            canvasContext.setLineDash([]);
        }
        
        // TODO draw grid
        
        // Additional drawing by the current mode
        activeMode.paint(canvasContext);
        
        canvasContext.globalCompositeOperation = 'source-over';
    };
    
    controller.on("toolChange", function(tool, toolInfo) {
        if (curSelectedMode == curDrawMode) {
            curSelectedMode = drawingModes[toolInfo.strokeMode];
        }
        curDrawMode = drawingModes[toolInfo.strokeMode];

        if (!spacePressed && mouseIn) {
            brushPreview = true;

            var 
                rect = getBrushPreviewOval();
            
            rect.grow(2, 2);
            
            if (oldPreviewRect != null) {
                rect.union(oldPreviewRect);
                oldPreviewRect = null;
            }

            repaintRect(rect);
        }
    });
    
    controller.on("modeChange", function(mode) {
        switch (mode) {
            case ChickenPaint.M_DRAW:
                curSelectedMode = curDrawMode;
                break;
    
            case ChickenPaint.M_FLOODFILL:
                curSelectedMode = floodFillMode;
                break;
    
            case ChickenPaint.M_RECT_SELECTION:
                curSelectedMode = rectSelectionMode;
                break;
    
            case ChickenPaint.M_MOVE_TOOL:
                curSelectedMode = moveToolMode;
                break;
    
            case ChickenPaint.M_ROTATE_CANVAS:
                curSelectedMode = rotateCanvasMode;
                break;
    
            case ChickenPaint.M_COLOR_PICKER:
                curSelectedMode = colorPickerMode;
                break;
        }
    });
    
    //
    // Modes system: modes control the way the GUI is reacting to the user input
    // All the tools are implemented through modes
    //
    
    defaultMode = new CPDefaultMode();
    colorPickerMode = new CPColorPickerMode();
    moveCanvasMode = new CPMoveCanvasMode();
    rotateCanvasMode = new CPRotateCanvasMode();
    floodFillMode = new CPFloodFillMode();
    rectSelectionMode = new CPRectSelectionMode();
    moveToolMode = new CPMoveToolMode();

    // this must correspond to the stroke modes defined in CPToolInfo
    drawingModes = [new CPFreehandMode(), new CPLineMode(), new CPBezierMode()];

    curDrawMode = drawingModes[CPBrushInfo.SM_FREEHAND];
    curSelectedMode = curDrawMode;
    activeMode = defaultMode;
    
    artworkCanvas.width = artwork.width;
    artworkCanvas.height = artwork.height;
    
    canvas.width = 1280;
    canvas.height = 1024;
    canvas.className = "chickenpaint-canvas";
    
    if (!canvasContext.setLineDash) { 
        canvasContext.setLineDash = function () {} // For IE 10 and older
    }
    
    container.appendChild(canvas);
    container.className = "chickenpaint-canvas-container";
    
    container.addEventListener("mouseenter", function() {
        mouseIn = true;
    });
    
    container.addEventListener("mouseleave", function() {
        mouseIn = false;
        that.paint();
    });
    
    container.addEventListener("mousedown", handleMouseDown);
    container.addEventListener("mousemove", handleMouseMove);
    
    artwork.on("updateRegion", function(region) {
        updateRegion.union(region);
        
        repaintRect(getRefreshArea(updateRegion));
    });
    
    centerCanvas();
    
    controller.setCanvas(this);
}