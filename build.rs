//! Compiles the Win32 icon resource into the executable so the .exe carries
//! its own icon in Explorer and on the taskbar. Regenerate the artwork with
//! `python desktop/icon/make_icon.py`.

fn main() {
    println!("cargo:rerun-if-changed=icon/neonamp.rc");
    println!("cargo:rerun-if-changed=icon/neonamp.ico");
    embed_resource::compile("icon/neonamp.rc", embed_resource::NONE)
        .manifest_required()
        .unwrap();
}
