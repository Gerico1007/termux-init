# ♠️🌿🎸🧵 termux-init — composable shell init
# Sources every snippet in ~/.bashrc.d/*.sh in lexical order.
# Each G.Music package owns its own file (00-core.sh, 20-assembly.sh, 40-portals.sh, …).
# Do not edit this stub by hand; add or edit files in ~/.bashrc.d/ instead.

for _bashrc_d_file in "$HOME"/.bashrc.d/*.sh; do
  [ -r "$_bashrc_d_file" ] && . "$_bashrc_d_file"
done
unset _bashrc_d_file
