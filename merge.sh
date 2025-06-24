#!/bin/bash
output_file="merged_tracks.gpx"
gpsbabel_options=""
for file in velotrex_tracks/*.gpx; do
    gpsbabel_options="$gpsbabel_options -f $file"
done
gpsbabel -i gpx $gpsbabel_options -o gpx -F "$output_file"

( echo "["; find velotrex_tracks/ -name '*.gpx' | xargs basename -a | cut -d'.' -f1 | awk '{print "\"http://velotrex.ru/trackview.php?file="$1"\","}'; echo "'']"; ) > visited_urls.json

