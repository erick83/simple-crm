// Evita abrir una ventana de consola CMD adicional en Windows en modo release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bisync_pos_lib::run();
}

