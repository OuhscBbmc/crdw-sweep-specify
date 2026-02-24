# ===========================================================================
# rebuild-embedded.R
# Regenerates js/data-embedded.js from whatever CSVs are in data/
#
# Usage:
#   Rscript rebuild-embedded.R
#
# This is needed when:
#   - You update any CSV in data/ (e.g. after running export-all.R)
#   - You want the app to work by double-clicking index.html (file:// protocol)
#
# When serving via HTTP (python -m http.server, GitHub Pages, etc.) the app
# reads CSVs directly via fetch(), so this script is optional in that case.
# ===========================================================================

library(readr)
library(jsonlite)

data_dir <- file.path(dirname(sys.frame(1)$ofile %||% "."), "data")
if (!dir.exists(data_dir)) data_dir <- "data"

out_path <- file.path(dirname(data_dir), "js", "data-embedded.js")

cat("Scanning", data_dir, "for dictionary-*.csv files...\n")

csv_files <- list.files(data_dir, pattern = "^dictionary-.*\\.csv$", full.names = TRUE)

if (length(csv_files) == 0) {
  stop("No dictionary-*.csv files found in ", data_dir)
}

lines <- c(
  "// ============================================================================",
  "// data-embedded.js",
  "// Auto-generated from data/*.csv by rebuild-embedded.R",
  paste0("// Generated: ", Sys.time()),
  "// Re-run:  Rscript rebuild-embedded.R",
  "// ============================================================================",
  "",
  "const EMBEDDED_DATA = {"
)

for (i in seq_along(csv_files)) {
  csv_path <- csv_files[i]
  fname <- basename(csv_path)

  cat("  Reading", fname, "...")
  df <- read_csv(csv_path, show_col_types = FALSE, locale = locale(encoding = "UTF-8"))
  cat(" ", nrow(df), "rows,", ncol(df), "columns\n")

  # Convert to list of named lists (JSON-friendly)
  row_list <- lapply(seq_len(nrow(df)), function(r) {
    row <- as.list(df[r, ])
    # Convert NAs to empty strings for JS
    lapply(row, function(v) if (is.na(v)) "" else as.character(v))
  })

  json <- toJSON(row_list, auto_unbox = TRUE, pretty = FALSE)

  comma <- if (i < length(csv_files)) "," else ""
  lines <- c(lines, paste0('  "', fname, '": ', json, comma))
}

lines <- c(lines, "};", "")

cat("Writing", out_path, "...\n")
writeLines(lines, out_path, useBytes = TRUE)

file_size <- file.info(out_path)$size
cat("Done!", length(csv_files), "files embedded.",
    "Output:", round(file_size / 1024, 1), "KB\n")

if (file_size > 5 * 1024 * 1024) {
  cat("\nWARNING: data-embedded.js is", round(file_size / 1024 / 1024, 1),
      "MB. Large files may slow page load.\n",
      "Consider serving via HTTP instead of embedding.\n")
}
