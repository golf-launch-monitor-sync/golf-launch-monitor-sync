# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The cases of dgvevent/1 (spec/hcp.md, *Taking one tournament*, 1.19.0): golf.de's tournament pages as a client sees
them (`pages`, read by event.py), and bodies a target gets (`examples`).

Made up by hand in the shape of golf.de's pages as they looked on 26 Nov 2026 (the labels and how a value is written);
every name, place and number here is invented. Never a page recorded from golf.de.
"""

from __future__ import annotations

import copy
from typing import Any

CLUB = "https://www.golf.de/sport/turnierkalender/clubturniere.html"
SEARCH = "?endtage=180&latitude=53.55&longitude=9.99&radius=50&offenundgeschlosseneTurniere=OPEN"

FULL_DE = [
    ["Turnierdatum", "Sa 12.06.2027 um 09:30 Uhr"],
    ["Turnierort", "Golfclub Beispielstadt e.V."],
    ["Turnierart", "Einzel - Stableford; 18 Löcher"],
    ["Handicap-Relevant", "Ja"],
    ["Starttee", "1"],
    ["Startzeit", "09:30 Uhr"],
    ["Teilnehmer maximal", "120"],
    ["Geschlecht", "Damen & Herren"],
    ["Gäste", "Ja"],
    ["Offenes / Geschlossenes Turnier", "Offenes Turnier"],
    ["Altersklasse", "Offen"],
    ["Meldeschluss Online", "09.06.2027, 18:00 Uhr"],
    ["Meldeschluss Club", "10.06.2027, 12:00 Uhr"],
]
FULL_EN = [
    ["Tournament Date", "Sat 12.06.2027 at 09:30"],
    ["Tournament Location", "Golfclub Beispielstadt e.V."],
    ["Tournament type", "Single - Stableford; 18 holes"],
    ["Handicap Relevant", "Yes"],
    ["Start tee", "1"],
    ["Start time", "09:30"],
    ["Participants maximum", "120"],
    ["Gender", "Woman & Men"],
    ["Guests", "Yes"],
    ["Open / Closed tournament", "Open tournament"],
    ["Age group", "Open"],
    ["Registration Deadline Online", "09.06.2027, 18:00"],
    ["Registration Deadline Club", "10.06.2027, 12:00"],
]


def page(address: str, heading: Any, lines: Any) -> dict[str, Any]:
    return {"address": address, "heading": heading, "lines": lines}


def with_line(lines: list[list[Any]], label: str, value: Any) -> list[list[Any]]:
    """The lines with `label`'s value changed (or the line left out with value None)."""
    out = []
    for la, v in lines:
        if la == label:
            if value is not None:
                out.append([la, value])
        else:
            out.append([la, v])
    return out


def pages() -> list[dict[str, Any]]:
    full = FULL_DE
    no_start = [["Turnierdatum", "Fr 27.08.2027"], ["Turnierort", "Golf Club Musterdorf e.V."],
                ["Turnierart", "Chapman-Vierer - Stableford; 18 Löcher"], ["Handicap-Relevant", "Nein"],
                ["Teilnehmer maximal", "80"], ["Geschlecht", "Damen & Herren"], ["Gäste", "Ja"],
                ["Offenes / Geschlossenes Turnier", "Offenes Turnier"], ["Altersklasse", "Offen"],
                ["Meldeschluss Online", "26.08.2027, 11:00 Uhr"], ["Meldeschluss Club", "26.08.2027, 11:00 Uhr"]]
    cases: list[tuple[str, str, dict[str, Any]]] = [
        ("club_page", "A club tournament's page with every line, opened from the list (its search after '?' stays out "
         "of url).", page(f"{CLUB}#/490000000001{SEARCH}", "Sommerpreis des Clubs", full)),
        ("no_start_lines", "A page without Starttee and Startzeit (they are left out on golf.de) and a day without a "
         "time: a foursome whose Turnierart names the holes.",
         page(f"{CLUB}#/490000000002", "Grünkohl-Vierer", no_start)),
        ("english_page", "golf.de's page in English: the same lines in English words.",
         page(f"{CLUB}#/490000000001", "Sommerpreis des Clubs", FULL_EN)),
        ("federation_page", "A regional federation's calendar; nine holes, closed, no guests, not for the handicap.",
         page("https://www.golf.de/sport/turnierkalender/lgv-turniere.html#/42", "Kreismeisterschaft der Senioren",
              [["Turnierdatum", "So 02.05.2027 um 08:00 Uhr"], ["Turnierort", "Golfpark Beispielheide"],
               ["Turnierart", "Zählspiel; 9 Löcher"], ["Handicap-Relevant", "Nein"], ["Gäste", "Nein"],
               ["Offenes / Geschlossenes Turnier", "Geschlossenes Turnier"], ["Altersklasse", "AK 50"]])),
        ("dgv_page", "The DGV's own calendar, as little as a page may have: the heading and the day.",
         page("https://www.golf.de/sport/turnierkalender/dgv-turniere.html#/987", "Offene Meisterschaft",
              [["Turnierdatum", "Sa 03.07.2027"]])),
        ("result_list", "A tournament's result list is no tournament's page.",
         page(f"{CLUB}#/490000000001/ergebnisse", "Sommerpreis des Clubs", full)),
        ("the_list", "The list of tournaments is no tournament's page.",
         page(f"{CLUB}#/{SEARCH}", "Clubturniere", [])),
        ("the_search", "golf.de's search form is no tournament's page.",
         page(f"{CLUB}#/filter{SEARCH}", "Clubturniere", [])),
        ("another_host", "Only golf.de's own pages (www, https).",
         page("https://golf.de/sport/turnierkalender/clubturniere.html#/490000000001", "X", full)),
        ("not_https", "Only over https.",
         page("http://www.golf.de/sport/turnierkalender/clubturniere.html#/490000000001", "X", full)),
        ("another_section", "A page outside the tournament calendar.",
         page("https://www.golf.de/mein-bereich.html#/490000000001", "X", full)),
        ("a_long_number", "golf.de's numbers have at most twelve digits.",
         page(f"{CLUB}#/1234567890123", "X", full)),
        ("no_heading", "No heading: golf.de changed its page; nothing is sent.", page(f"{CLUB}#/7", "  ", full)),
        ("heading_too_long", "A heading longer than a tournament's name can be.", page(f"{CLUB}#/7", "N" * 201, full)),
        ("no_date_line", "Without its first day there is no tournament to take.",
         page(f"{CLUB}#/7", "Herbstpreis", with_line(full, "Turnierdatum", None))),
        ("date_unreadable", "A day it can't read.",
         page(f"{CLUB}#/7", "Herbstpreis", with_line(full, "Turnierdatum", "im Herbst"))),
        ("date_not_a_day", "A day no calendar has.",
         page(f"{CLUB}#/7", "Herbstpreis", with_line(full, "Turnierdatum", "Mi 31.02.2027"))),
        ("lines_moved_and_more", "Lines by their label, not their place; labels it doesn't know (a fee, a contact) are "
         "never read.",
         page(f"{CLUB}#/8", "Preis des Präsidenten",
              [["Ansprechpartner", "Max Mustermann, 040 123456"], ["Gäste", "Ja"], ["Nenngeld", "45 €"],
               ["Turnierart", "Texas Scramble"], ["Turnierdatum", "Sa 07.08.2027 um 13:00 Uhr"],
               ["Startliste", "Erika Mustermann, Max Mustermann"], ["Turnierort", "Golfclub Beispielstadt e.V."]])),
        ("labels_written_otherwise", "A colon after a label, double and non-breaking spaces, another case.",
         page(f"{CLUB}#/9", "  Herbst Vierer  ",
              [["Turnierdatum:", "Sa 11.09.2027  um 10:00 Uhr"], ["teilnehmer  maximal", " 60 "],
               ["HANDICAP-RELEVANT", "ja"], ["Gäste:", "NEIN"]])),
        ("values_that_dont_read", "A value that isn't one of its field is left out, the rest stays.",
         page(f"{CLUB}#/10", "Herbstpreis",
              [["Turnierdatum", "Sa 18.09.2027"], ["Startzeit", "nach Absprache"], ["Turnierart", "Stableford; 27 Löcher"],
               ["Handicap-Relevant", "vielleicht"], ["Teilnehmer maximal", "unbegrenzt"], ["Gäste", "auf Anfrage"],
               ["Offenes / Geschlossenes Turnier", "weiß nicht"], ["Meldeschluss Online", "bald"],
               ["Meldeschluss Club", "31.09.2027"], ["Starttee", "Gelb, Rot, Blau, Orange, Weiß, Schwarz und alle "
                                                                 "anderen Farben"],
               ["Altersklasse", "-"], ["Geschlecht", "–"]])),
        ("numbers_out_of_range", "Nobody plays with none or more than 9999; 25:00 is no time.",
         page(f"{CLUB}#/11", "Herbstpreis", [["Turnierdatum", "Sa 18.09.2027 um 25:00 Uhr"],
                                              ["Teilnehmer maximal", "0"], ["Startzeit", "24:30 Uhr"]])),
        ("too_many_players", "More than 9999 isn't a field's size.", page(f"{CLUB}#/12", "Herbstpreis", [["Turnierdatum", "Sa 18.09.2027"],
                                                                     ["Teilnehmer maximal", "10000"]])),
        ("start_time_first", "Startzeit before the time the day's line names.",
         page(f"{CLUB}#/13", "Herbstpreis", [["Turnierdatum", "Sa 18.09.2027 um 08:00 Uhr"], ["Startzeit", "9:05 Uhr"]])),
        ("first_line_counts", "A label twice: the first counts.",
         page(f"{CLUB}#/14", "Herbstpreis", [["Turnierdatum", "Sa 18.09.2027"], ["Turnierort", "Platz A"],
                                              ["Turnierort", "Platz B"], ["Turnierdatum", "So 19.09.2027"]])),
        ("holes_alone", "Turnierart that names only the holes.",
         page(f"{CLUB}#/15", "Herbstpreis", [["Turnierdatum", "Sa 18.09.2027"], ["Turnierart", "18 Löcher"]])),
        ("holes_first", "The holes before the form of play.",
         page(f"{CLUB}#/16", "Herbstpreis", [["Turnierdatum", "Sa 18.09.2027"], ["Turnierart", "9 Loch - Stableford"]])),
        ("deadline_without_time", "A deadline without its time is its day.",
         page(f"{CLUB}#/17", "Herbstpreis", [["Turnierdatum", "Sa 18.09.2027"], ["Meldeschluss Online", "15.09.2027"]])),
        ("lines_that_arent", "What isn't a pair of label and value is passed over.",
         page(f"{CLUB}#/18", "Herbstpreis", [["Turnierdatum"], 5, ["Turnierort", 7], None, ["Turnierdatum", "Sa 18.09.2027"],
                                              ["Turnierort", "Golfclub Beispielstadt e.V.", "zu viel"]])),
        ("long_texts", "A text longer than its field is left out, not cut.",
         page(f"{CLUB}#/19", "Herbstpreis", [["Turnierdatum", "Sa 18.09.2027"], ["Turnierort", "O" * 201],
                                              ["Turnierart", "F" * 101], ["Geschlecht", "G" * 60]])),
        ("no_lines", "No lines at all: golf.de changed its page.", page(f"{CLUB}#/20", "Herbstpreis", "lines")),
        ("not_a_page", "Not a page at all.", "page"),
    ]
    return [{"name": n, "why": w, "input": p} for n, w, p in cases]


# ---------------------------------------------------------------------------
# Bodies a target gets
# ---------------------------------------------------------------------------
GENERATOR = {"name": "Golf Stats Sync for Chrome and Edge", "version": "0.23.0"}


def examples(full_event: dict[str, Any]) -> list[dict[str, Any]]:
    """Each with `valid` (the schema) and `target`: what a target does reading it (spec/hcp.md: a frame it can't place
    is refused as a whole, any other value that isn't right is left out and named in `dropped`, a field the format
    hasn't is never read)."""
    base = {"format": "dgvevent/1", "provider": "golfde"}
    least = {**base, "event": {"id": "42", "url": "https://www.golf.de/sport/turnierkalender/lgv-turniere.html#/42",
                               "name": "Kreismeisterschaft", "date": "2027-05-01"}}

    def but(name: str, why: str, change: Any, valid: bool, target: dict[str, Any]) -> dict[str, Any]:
        b = copy.deepcopy(least)
        change(b)
        return {"name": name, "why": why, "valid": valid, "body": b, "target": target}

    def ev(**kw: Any) -> Any:
        return lambda b: b["event"].update(kw)

    refused = {"refused": True}
    return [
        {"name": "everything_the_page_shows", "why": "A club tournament's page with every line, as a client writes it.",
         "valid": True, "body": {**base, "generator": GENERATOR, "event": full_event}, "target": {"dropped": []}},
        {"name": "the_least_a_page_has", "why": "The page's number and address, the heading and the first day.",
         "valid": True, "body": least, "target": {"dropped": []}},
        but("number_as_a_number_and_nulls", "Not as the schema has it, but a target still reads it: the number as a "
            "JSON number, unknown values as null.", ev(id=42, time=None, tee=None), False, {"dropped": []}),
        but("with_the_search", "The address with the search the player came from: a client leaves it out, a target "
            "takes it.", ev(url="https://www.golf.de/sport/turnierkalender/lgv-turniere.html#/42?radius=50"), False,
            {"dropped": []}),
        but("without_www", "golf.de without www: a target takes it.",
            ev(url="https://golf.de/sport/turnierkalender/lgv-turniere.html#/42"), False, {"dropped": []}),
        but("wrong_format", "Another format.", lambda b: b.update(format="dgvhcp/1"), False, refused),
        but("a_list", "One tournament, never a list.", lambda b: b.update(event=[copy.deepcopy(b["event"])]), False,
            refused),
        but("another_provider", "A tournament comes from golf.de only.", lambda b: b.update(provider="egr"), False,
            refused),
        but("another_site", "The page is golf.de's.",
            ev(url="https://golf.example/sport/turnierkalender/lgv-turniere.html#/42"), False, refused),
        but("the_list_not_a_page", "The list's address, not a tournament's.",
            ev(url="https://www.golf.de/sport/turnierkalender/lgv-turniere.html#/?radius=50"), False, refused),
        but("another_pages_number", "The number is the page's: id and the number in url agree (which the schema can't "
            "say).", ev(id="43"), True, refused),
        but("no_name", "A tournament has its name.", ev(name="  "), False, refused),
        but("day_as_german", "Days are YYYY-MM-DD.", ev(date="01.05.2027"), False, refused),
        but("no_day", "A tournament has its first day.", lambda b: b["event"].pop("date"), False, refused),
        but("bad_values_cost_themselves", "Each value that isn't right is left out on its own; the tournament stays.",
            ev(time="9:30 Uhr", holes=27, hcp_relevant="ja", max_players=0, entry_close_online="15.09.2027",
               tee="Gelb, Rot, Blau, Orange, Weiß, Schwarz und alle anderen Farben, die der Club noch hat"), False,
            {"dropped": ["time", "holes", "hcp_relevant", "max_players", "entry_close_online", "tee"]}),
        but("fields_the_format_has_not", "A start list, a fee, a contact: no field of the format, never read.",
            ev(start_list=[{"name": "Erika Mustermann", "hcp": 12.3}], fee="45 €", contact="Max Mustermann, 040 123456"),
            False, {"dropped": []}),
        but("unknown_top_level", "Nothing beside the tournament.", lambda b: b.update(player="Erika Mustermann"), False,
            {"dropped": []}),
    ]
