use gpui::{
    App, Bounds, Context, CursorStyle, Element, ElementId, ElementInputHandler, Entity,
    EntityInputHandler, FocusHandle, Focusable, GlobalElementId, KeyBinding, LayoutId, MouseButton,
    MouseDownEvent, PaintQuad, Pixels, Point, ShapedLine, SharedString, Style, TextRun,
    UTF16Selection, Window, actions, div, fill, hsla, point, prelude::*, px, relative, rgb, size,
    white,
};
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;

actions!(
    text_input,
    [
        Backspace,
        Delete,
        Left,
        Right,
        Home,
        End,
        Paste,
        ShowCharacterPalette
    ]
);

pub fn bind_text_input_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, None),
        KeyBinding::new("delete", Delete, None),
        KeyBinding::new("left", Left, None),
        KeyBinding::new("right", Right, None),
        KeyBinding::new("home", Home, None),
        KeyBinding::new("end", End, None),
        KeyBinding::new("cmd-v", Paste, None),
        KeyBinding::new("ctrl-cmd-space", ShowCharacterPalette, None),
    ]);
}

pub struct TextInput {
    focus_handle: FocusHandle,
    content: SharedString,
    placeholder: SharedString,
    cursor: usize,
    last_layout: Option<ShapedLine>,
    last_bounds: Option<Bounds<Pixels>>,
}

impl TextInput {
    pub fn new(cx: &mut App, placeholder: impl Into<SharedString>) -> Entity<Self> {
        let placeholder = placeholder.into();
        cx.new(|cx| Self {
            focus_handle: cx.focus_handle(),
            content: "".into(),
            placeholder,
            cursor: 0,
            last_layout: None,
            last_bounds: None,
        })
    }

    pub fn value(&self) -> String {
        self.content.to_string()
    }

    pub fn clear(&mut self) {
        self.content = "".into();
        self.cursor = 0;
        self.last_layout = None;
        self.last_bounds = None;
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.cursor = offset.min(self.content.len());
        cx.notify();
    }

    fn previous_boundary(&self) -> usize {
        self.content
            .grapheme_indices(true)
            .rev()
            .find_map(|(index, _)| (index < self.cursor).then_some(index))
            .unwrap_or(0)
    }

    fn next_boundary(&self) -> usize {
        self.content
            .grapheme_indices(true)
            .find_map(|(index, _)| (index > self.cursor).then_some(index))
            .unwrap_or(self.content.len())
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf8_offset = 0;
        let mut utf16_count = 0;
        for ch in self.content.chars() {
            if utf16_count >= offset {
                break;
            }
            utf16_count += ch.len_utf16();
            utf8_offset += ch.len_utf8();
        }
        utf8_offset
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let mut utf16_offset = 0;
        let mut utf8_count = 0;
        for ch in self.content.chars() {
            if utf8_count >= offset {
                break;
            }
            utf8_count += ch.len_utf8();
            utf16_offset += ch.len_utf16();
        }
        utf16_offset
    }

    fn index_for_mouse_position(&self, position: Point<Pixels>) -> usize {
        let (Some(bounds), Some(line)) = (self.last_bounds.as_ref(), self.last_layout.as_ref())
        else {
            return 0;
        };
        if position.x <= bounds.left() {
            return 0;
        }
        if position.x >= bounds.right() {
            return self.content.len();
        }
        line.closest_index_for_x(position.x - bounds.left())
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.previous_boundary(), cx);
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.next_boundary(), cx);
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(0, cx);
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.content.len(), cx);
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        let previous = self.previous_boundary();
        if previous < self.cursor {
            self.replace_text_in_range(
                Some(self.offset_to_utf16(previous)..self.offset_to_utf16(self.cursor)),
                "",
                window,
                cx,
            );
        }
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        let next = self.next_boundary();
        if self.cursor < next {
            self.replace_text_in_range(
                Some(self.offset_to_utf16(self.cursor)..self.offset_to_utf16(next)),
                "",
                window,
                cx,
            );
        }
    }

    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.replace_text_in_range(None, &text.replace('\n', " "), window, cx);
        }
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.move_to(self.index_for_mouse_position(event.position), cx);
    }

    fn show_character_palette(
        &mut self,
        _: &ShowCharacterPalette,
        window: &mut Window,
        _: &mut Context<Self>,
    ) {
        window.show_character_palette();
    }
}

impl EntityInputHandler for TextInput {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        actual_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let range =
            self.offset_from_utf16(range_utf16.start)..self.offset_from_utf16(range_utf16.end);
        actual_range.replace(self.offset_to_utf16(range.start)..self.offset_to_utf16(range.end));
        Some(self.content[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let cursor = self.offset_to_utf16(self.cursor);
        Some(UTF16Selection {
            range: cursor..cursor,
            reversed: false,
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        None
    }

    fn unmark_text(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range_utf16
            .map(|range| self.offset_from_utf16(range.start)..self.offset_from_utf16(range.end))
            .unwrap_or(self.cursor..self.cursor);
        self.content = format!(
            "{}{}{}",
            &self.content[..range.start],
            new_text,
            &self.content[range.end..]
        )
        .into();
        self.cursor = range.start + new_text.len();
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        _new_selected_range_utf16: Option<Range<usize>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.replace_text_in_range(range_utf16, new_text, window, cx);
    }

    fn bounds_for_range(
        &mut self,
        range_utf16: Range<usize>,
        bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let layout = self.last_layout.as_ref()?;
        let start = self.offset_from_utf16(range_utf16.start);
        let end = self.offset_from_utf16(range_utf16.end);
        Some(Bounds::from_corners(
            point(bounds.left() + layout.x_for_index(start), bounds.top()),
            point(bounds.left() + layout.x_for_index(end), bounds.bottom()),
        ))
    }

    fn character_index_for_point(
        &mut self,
        point: Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        let layout = self.last_layout.as_ref()?;
        let bounds = self.last_bounds.as_ref()?;
        let index = layout.index_for_x(point.x - bounds.left())?;
        Some(self.offset_to_utf16(index))
    }
}

struct TextElement {
    input: Entity<TextInput>,
}

struct PrepaintState {
    line: ShapedLine,
    cursor: PaintQuad,
}

impl IntoElement for TextElement {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for TextElement {
    type RequestLayoutState = ();
    type PrepaintState = PrepaintState;

    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mut style = Style::default();
        style.size.width = relative(1.0).into();
        style.size.height = window.line_height().into();
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let input = self.input.read(cx);
        let style = window.text_style();
        let text = if input.content.is_empty() {
            input.placeholder.clone()
        } else {
            input.content.clone()
        };
        let color = if input.content.is_empty() {
            hsla(0.0, 0.0, 0.0, 0.35)
        } else {
            style.color
        };
        let run = TextRun {
            len: text.len(),
            font: style.font(),
            color,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let font_size = style.font_size.to_pixels(window.rem_size());
        let line = window
            .text_system()
            .shape_line(text, font_size, &[run], None);
        let cursor_x = bounds.left() + line.x_for_index(input.cursor);
        let cursor = fill(
            Bounds::new(
                point(cursor_x, bounds.top()),
                size(px(2.0), bounds.bottom() - bounds.top()),
            ),
            rgb(0x9e3d2d),
        );
        PrepaintState { line, cursor }
    }

    fn paint(
        &mut self,
        _id: Option<&GlobalElementId>,
        _inspector_id: Option<&gpui::InspectorElementId>,
        bounds: Bounds<Pixels>,
        _request_layout: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus_handle = self.input.read(cx).focus_handle.clone();
        window.handle_input(
            &focus_handle,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        prepaint
            .line
            .paint(bounds.origin, window.line_height(), window, cx)
            .ok();
        if focus_handle.is_focused(window) {
            window.paint_quad(prepaint.cursor.clone());
        }
        let line = prepaint.line.clone();
        self.input.update(cx, |input, _| {
            input.last_layout = Some(line);
            input.last_bounds = Some(bounds);
        });
    }
}

impl Render for TextInput {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("TextInput")
            .track_focus(&self.focus_handle(cx))
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::show_character_palette))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .bg(rgb(0xfffbf5))
            .border_1()
            .border_color(rgb(0xd9cdbf))
            .rounded_md()
            .px_3()
            .py_2()
            .line_height(px(24.0))
            .text_size(px(18.0))
            .child(
                div()
                    .h(px(24.0))
                    .w_full()
                    .bg(white())
                    .child(TextElement { input: cx.entity() }),
            )
    }
}

impl Focusable for TextInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}
