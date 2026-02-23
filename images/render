#!/bin/bash

FORCE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
	case $1 in
		--force)
			FORCE=true
			shift
			;;
		*)
			echo "Unknown option: $1"
			echo "Usage: $0 [--force]"
			exit 1
			;;
	esac
done

for ipefile in *.ipe; do
	name=${ipefile%.*}
	svgfile="$name.svg"
	
	# Check if we need to render:
	# - Force mode is enabled, OR
	# - SVG doesn't exist, OR
	# - IPE file is newer than SVG
	if $FORCE || [ ! -f "$svgfile" ] || [ "$ipefile" -nt "$svgfile" ]; then
		echo "Rendering $ipefile"
		iperender -svg "$ipefile" "$svgfile"
	else
		echo "Skipping $ipefile (up to date)"
	fi
done
