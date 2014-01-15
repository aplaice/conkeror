/**
 * (C) Copyright 2004-2007 Shawn Betts
 * (C) Copyright 2007-2010 John J. Foerch
 * (C) Copyright 2007-2008 Jeremy Maitin-Shepard
 *
 * Use, modification, and distribution are subject to the terms specified in the
 * COPYING file.
**/

require("window.js");
require("keymap.js");
require("interactive.js");

define_variable("key_bindings_ignore_capslock", false,
    "When true, the case of characters in key bindings will be based "+
    "only on whether shift was pressed--upper-case if yes, lower-case if "+
    "no.  Effectively, this overrides the capslock key.  This option has "+
    "no effect on ordinary typing in input fields.");

define_variable("keyboard_key_sequence_help_timeout", 0,
    "Delay (in millseconds) before the current key sequence prefix is "+
    "displayed in the minibuffer.");


/**
 * event_clone is used to make a copy of an event which is safe to keep
 * references to, because it will not reference any DOM trees directly
 * or indirectly.
 *
 * A pertinent question would be, is this needed?  Are there instances
 * in Conkeror when an event reference is stored across a navigation
 * boundary or buffer/window closing?
 */
function event_clone (event) {
    this.type = event.type;
    this.keyCode = event.keyCode;
    this.charCode = event.charCode;
    this.button = event.button;
    this.command = event.command;
    this.ctrlKey = event.ctrlKey;
    this.metaKey = event.metaKey;
    this.altKey = event.altKey;
    this.shiftKey = event.shiftKey;
    this.superKey = modifiers.s.in_event_p(event);
    this.sticky_modifiers = event.sticky_modifiers;
}


/**
 * event_kill stops an event from being processed by any further handlers.
 */
function event_kill (event) {
    event.preventDefault();
    event.stopPropagation();
}

/**
 * window_input_state encapsulates all of the per-window data for the input system
 **/
function window_input_state () {
    /**
     * Maps keycodes to true to indicate that the next keyup event for that key
     * should be allowed to fall through.  This is a global property, since once
     * the keydown is received, the keyup could occur at any time.
     **/
    this.fallthrough = {};

    /**
     * There is at most one current input context.
     *
     * If this is non-null, it is an interactive_context object created by
     * input_make_interactive_context.
     **/
    this.current_context = null;

    /**
     * timer ID for current delayed display of key sequence help
     **/
    this.help_timer = null;
}

function input_make_interactive_context (window) {
    var I = new interactive_context(window.buffers.current);

    I.key_sequence = [];

    I.sticky_modifiers = 0;

    /**
     * Initial keymap at 
     **/
    I.initial_keymaps = get_current_keymaps(window);

    /**
     * Indicates if this interactive context was created due to this event.  For
     * special key handling, this is useful for determining whether to call
     * input_continue_with_state or not.
     **/
    I.first_event = true;

    /**
     * Current keymap
     **/
    I.keymaps = I.initial_keymaps;

    /**
     * Additional overlay keymap
     **/
    I.overlay_keymap = null;

    /**
     * Indicates if key sequence help has already been displayed.  If so,
     * additional key sequence help will be displayed immediately rather than
     * only after a delay.
     **/
    I.help_displayed = false;

    return I;
}

function input_help_timer_clear (window) {
    var state = window.input;
    if (state.help_timer != null) {
        timer_cancel(state.help_timer);
        state.help_timer = null;
    }
}


function input_show_partial_sequence (window, I) {
    var state = window.input;
    if (I.help_displayed) {
        if (I.key_sequence.length > 0) {
            window.minibuffer.show(I.key_sequence.join(" "));
        }
    }
    else {
        if (state.help_timer != null)
            timer_cancel(state.help_timer);

        if (I.key_sequence.length > 0) {
            state.help_timer = call_after_timeout(function () {
                window.minibuffer.show(I.key_sequence.join(" "));
                I.help_displayed = true;
                state.help_timer = null;
            }, keyboard_key_sequence_help_timeout);
        }
    }
}


define_window_local_hook("keypress_hook", RUN_HOOK_UNTIL_SUCCESS,
    "A run-until-success hook available for special keypress "+
    "handling.  Handlers receive as arguments the window, an "+
    "interactive context, and the real keypress event.  The "+
    "handler is responsible for stopping event propagation, if "+
    "that is desired.");


/**
 * get_current_keymaps returns the keymap stack for the current focus
 * context of the given window.  This is the top-level keymap stack, not
 * the stack that represents any on-going key sequence.
 */
function get_current_keymaps (window) {
    var m = window.minibuffer;
    var s = m.current_state;
    if (m.active && s.keymaps)
        return s.keymaps;
    return window.buffers.current.keymaps;
}



// precondition: I.window.input.help_timer == null
function input_handle_binding (I, true_event, binding) {

    var window = I.window;
    var state = window.input;

    if (!binding || !binding.fallthrough)
        event_kill(true_event);

    if (!binding) {
        window.minibuffer.message(I.key_sequence.join(" ") + " is undefined");
        state.current_context = null;
        return;
    }

    if (binding.browser_object !== undefined)
        I.binding_browser_object = binding.browser_object;

    if (array_p(binding)) {
        I.keymaps = binding;
        input_show_partial_sequence(window, I);
        return;
    }

    // Cancel current context for now
    // If the command is a prefix command and runs successfully, the context will be restored later
    state.current_context = null;

    if (binding.command) {

        let command = binding.command;

        if (I.repeat == command) {
            // Already ran command once, run alternate command
            command = binding.repeat;
        }

        if (binding.repeat) {
            // Indicate that we are running command, so that next time we will run the alternate command
            I.repeat = command;
        }

        input_run_command(I, command);

    } else {
        // Fallthrough: do nothing
    }
}

function input_continue_with_state (I) {
    var window = I.window;
    var state = window.input;

    if (state.current_context != null)
        throw interactive_error("Warning: nested key sequence attempted, aborted");

    state.current_context = I;
    input_show_partial_sequence(window, I);
}

// The input system is safely re-entrant for non-prefix commands, meaning a command can itself invoke input_run_command.
function input_run_command (I, command) {
    var window = I.window;
    var state = window.input;
    spawn(function () {
        try {
            var is_prefix = yield run_interactively(I, command);

            if (is_prefix) {
                // reset to initial keymap
                I.keymaps = I.initial_keymaps;

                input_continue_with_state(I);
            }

        } catch (e) {
            handle_interactive_error(window, e);
        }
    }());
}


/**
 * input_handle_sequence is the main handler for all event types which
 * can be part of a sequence.  It is a coroutine procedure which gets
 * started and resumed by various EventListeners, some of which have
 * additional, special tasks.
 */
function input_handle_event (window, event) {
    try {
        var state = window.input;
        var I = state.current_context;
        if (I == null)
            I = state.current_context = input_make_interactive_context(window);
        else
            I.first_event = false;

        // Clear any existing minibuffer message due to new event
        window.minibuffer.clear();

        // Reset timer because of new event
        input_help_timer_clear(window);

        // prepare the clone
        var clone = new event_clone(event);
        clone.sticky_modifiers = I.sticky_modifiers;
        I.sticky_modifiers = 0;
        if (key_bindings_ignore_capslock && clone.charCode) {
            let c = String.fromCharCode(clone.charCode);
            if (clone.shiftKey)
                clone.charCode = c.toUpperCase().charCodeAt(0);
            else
                clone.charCode = c.toLowerCase().charCodeAt(0);
        }

        // make the combo string
        var combo = format_key_combo(clone);
        I.combo = combo;
        I.event = clone;

        if (keypress_hook.run(window, I, event))
            return;

        var canabort = I.key_sequence.push(combo) > 1;


        var overlay_keymap = I.overlay_keymap;

        var binding =
            (canabort && keymap_lookup([sequence_abort_keymap], combo, event)) ||
            (overlay_keymap && keymap_lookup([overlay_keymap], combo, event)) ||
            keymap_lookup(I.keymaps, combo, event) ||
            keymap_lookup([sequence_help_keymap], combo, event);

        input_handle_binding(I, event, binding);
    } catch (e) {
        dump_error(e);
    }
}


function input_handle_keydown (event) {
    if (event.keyCode == 0 ||
        event.keyCode == vk_name_to_keycode.shift ||
        event.keyCode == vk_name_to_keycode.control ||
        event.keyCode == vk_name_to_keycode.alt ||
        event.keyCode == vk_name_to_keycode.caps_lock)
        return event_kill(event);
    var window = this;
    var state = window.input;
    var keymaps = state.current_context != null ?
        state.current_context.keymaps : get_current_keymaps(window);

    //try the fallthrough predicates in our current keymap
    if (keymap_lookup_fallthrough(keymaps[keymaps.length - 1], event)) {
        //XXX: need to take account of modifers, too!
        state.fallthrough[event.keyCode] = true;
    } else
        event_kill(event);
}


function input_handle_keypress (event) {
    if (event.keyCode == 0 && event.charCode == 0 ||
        event.keyCode == vk_name_to_keycode.caps_lock)
        return event_kill(event);
    var window = this;
    var state = window.input;
    input_handle_event(window, event);
}


function input_handle_keyup (event) {
    if (event.keyCode == 0 ||
        event.keyCode == vk_name_to_keycode.shift ||
        event.keyCode == vk_name_to_keycode.control ||
        event.keyCode == vk_name_to_keycode.alt ||
        event.keyCode == vk_name_to_keycode.caps_lock)
        return event_kill(event);
    var window = this;
    var state = window.input;
    if (state.fallthrough[event.keyCode])
        delete state.fallthrough[event.keyCode];
    else
        event_kill(event);
}


function input_handle_appcommand (event) {
    var window = this;
    input_handle_event(window, event);
}

function input_initialize_window (window) {
    window.input = new window_input_state();
    //window.addEventListener("keydown", input_handle_keydown, true);
    window.addEventListener("keypress", input_handle_keypress, true);
    //window.addEventListener("keyup", input_handle_keyup, true);
    //TO-DO: mousedown, mouseup, click, dblclick
    window.addEventListener("AppCommand", input_handle_appcommand, true);
}

add_hook("window_initialize_hook", input_initialize_window);


interactive("sequence-abort",
    "Abort an ongoing key sequence.",
    function (I) { I.minibuffer.message("abort sequence"); });

provide("input");
