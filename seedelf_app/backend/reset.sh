#!/usr/bin/env bash

clear
echo -e "\033[5;37m\nPress Enter To Delete The Db, Or Any Other Key To Exit.\n\033[0m"
read -rsn1 input

if [[ "$input" == "" ]]; then
    clear
    echo -e "\033[1;31m\nDeleting Logs And Db...\n\033[0m"
    rm *.log || true
    rm db.sqlite3 || true
    exit 0
else
    clear
    echo -e "\033[1;32m\nExiting...\n\033[0m"
    exit 1
fi

