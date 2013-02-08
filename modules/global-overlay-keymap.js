/**
 * (C) Copyright 2008 Jeremy Maitin-Shepard
 * (C) Copyright 2008-2009 John J. Foerch
 *
 * Use, modification, and distribution are subject to the terms specified in the
 * COPYING file.
**/

require("input.js");

define_keymap("global_overlay_keymap");


function global_overlay_keymap_handler (window, I, true_event) {
    var binding = keymap_lookup([global_overlay_keymap], I.combo, I.event);
    if (!binding)
        return false;
    input_handle_binding(I, true_event, binding);
    return true;
}


define_global_mode("global_overlay_keymap_mode",
                   function () {
                       add_hook("keypress_hook", global_overlay_keymap_handler);
                   },
                   function () {
                       remove_hook("keypress_hook", global_overlay_keymap_handler);
                   });


function define_key_alias (typed_key, generated_key) {
    var name = "generate-key-event:"+generated_key;

    // This is not a prefix command, because we need finer-grained control over the input state.
    interactive(name,
        "Generate a fake key press event for the key: "+generated_key,
        function (I) {
            // Effectively leave the input state almost exactly as it was prior to this key event
            if (!I.first_event)
                input_continue_with_state(I);

            // Warning: event handler is called before send_key_as_event returns
            send_key_as_event(I.window,
                              I.buffer.focused_element,
                              generated_key);
        });
    define_key(global_overlay_keymap, typed_key, name);
    global_overlay_keymap_mode(true);
}
ignore_function_for_get_caller_source_code_reference("define_key_alias");


function define_sticky_modifier (typed_key, modifiers) {
    var name = "sticky-modifiers:"+modifiers;
    interactive(name, "Set sticky modifiers: "+modifiers,
                function (I) {
                    I.sticky_modifiers = modifiers;
                }, $prefix);
    define_key(global_overlay_keymap, typed_key, name);
    global_overlay_keymap_mode(true);
}
ignore_function_for_get_caller_source_code_reference("define_sticky_modifier");

provide("global-overlay-keymap");
