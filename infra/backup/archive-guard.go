package main

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"hash"
	"io"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	hardMaxMembers      = uint64(1_000_000)
	hardMaxExpandedSize = uint64(1 << 40) // 1 TiB; operators may choose a lower restore limit.
	maxArchivePathBytes = 4096
	maxManifestLineSize = 16 << 10
	hardMaxManifestSize = uint64(64 << 20)
	maxTarZeroPadding   = 16 << 20
)

type archiveLimits struct {
	maxMembers      uint64
	maxExpandedSize uint64
}

type archiveSummary struct {
	members      uint64
	expandedSize uint64
}

type zeroPaddingWriter struct {
	count uint64
}

func (writer *zeroPaddingWriter) Write(data []byte) (int, error) {
	if writer.count+uint64(len(data)) > maxTarZeroPadding {
		return 0, errors.New("tar archive has excessive trailing padding")
	}
	for _, value := range data {
		if value != 0 {
			return 0, errors.New("tar archive contains data after its end marker")
		}
	}
	writer.count += uint64(len(data))
	return len(data), nil
}

func validateLimits(limits archiveLimits) error {
	if limits.maxMembers == 0 || limits.maxMembers > hardMaxMembers {
		return fmt.Errorf("member limit must be between 1 and %d", hardMaxMembers)
	}
	if limits.maxExpandedSize == 0 || limits.maxExpandedSize > hardMaxExpandedSize {
		return fmt.Errorf("expanded-size limit must be between 1 and %d", hardMaxExpandedSize)
	}
	return nil
}

func normalizeArchivePath(rawName string, isDirectory bool) (string, bool, error) {
	if rawName == "" || !utf8.ValidString(rawName) || len(rawName) > maxArchivePathBytes {
		return "", false, errors.New("archive member has an empty, invalid, or oversized path")
	}
	if strings.ContainsRune(rawName, '\x00') || strings.Contains(rawName, "\\") || path.IsAbs(rawName) {
		return "", false, errors.New("archive member path is absolute or ambiguous")
	}

	name := rawName
	for strings.HasPrefix(name, "./") {
		name = strings.TrimPrefix(name, "./")
	}
	if name == "" {
		if isDirectory {
			return ".", true, nil
		}
		return "", false, errors.New("regular file cannot represent the archive root")
	}

	if isDirectory {
		name = strings.TrimSuffix(name, "/")
	} else if strings.HasSuffix(name, "/") {
		return "", false, errors.New("regular file path cannot end with a slash")
	}
	if name == "" {
		return ".", true, nil
	}

	parts := strings.Split(name, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || len([]byte(part)) > 255 {
			return "", false, errors.New("archive member path is not canonical or escapes its root")
		}
	}
	cleaned := path.Clean(name)
	if cleaned != name || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", false, errors.New("archive member path is not canonical or escapes its root")
	}
	return cleaned, false, nil
}

func validateHeader(header *tar.Header) (string, bool, error) {
	isDirectory := header.Typeflag == tar.TypeDir
	isRegular := header.Typeflag == tar.TypeReg || header.Typeflag == tar.TypeRegA
	if !isDirectory && !isRegular {
		return "", false, fmt.Errorf("archive member type %d is forbidden", header.Typeflag)
	}
	if header.Linkname != "" {
		return "", false, errors.New("archive members may not carry a link target")
	}
	if header.Size < 0 || (isDirectory && header.Size != 0) {
		return "", false, errors.New("archive member declares an invalid size")
	}
	return normalizeArchivePath(header.Name, isDirectory)
}

func walkArchive(reader io.Reader, limits archiveLimits, onEntry func(*tar.Header, string, bool, io.Reader) error) (archiveSummary, error) {
	compressed, err := gzip.NewReader(reader)
	if err != nil {
		return archiveSummary{}, fmt.Errorf("open gzip stream: %w", err)
	}
	tape := tar.NewReader(compressed)
	seen := make(map[string]byte)
	summary := archiveSummary{}

	for {
		header, nextErr := tape.Next()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			return archiveSummary{}, fmt.Errorf("read tar header: %w", nextErr)
		}
		summary.members++
		if summary.members > limits.maxMembers {
			return archiveSummary{}, fmt.Errorf("archive exceeds member limit %d", limits.maxMembers)
		}

		memberPath, isRoot, headerErr := validateHeader(header)
		if headerErr != nil {
			return archiveSummary{}, fmt.Errorf("unsafe archive member: %w", headerErr)
		}
		if _, duplicate := seen[memberPath]; duplicate {
			return archiveSummary{}, fmt.Errorf("archive contains duplicate path %q", memberPath)
		}
		entryType := byte('f')
		if header.Typeflag == tar.TypeDir {
			entryType = 'd'
		}
		seen[memberPath] = entryType

		if header.Size > 0 {
			size := uint64(header.Size)
			if size > limits.maxExpandedSize-summary.expandedSize {
				return archiveSummary{}, fmt.Errorf("archive exceeds expanded-size limit %d", limits.maxExpandedSize)
			}
			summary.expandedSize += size
		}

		if !isRoot {
			for parent := path.Dir(memberPath); parent != "."; parent = path.Dir(parent) {
				if seen[parent] == 'f' {
					return archiveSummary{}, fmt.Errorf("regular file %q is the parent of another member", parent)
				}
			}
		}
		if entryType == 'f' {
			prefix := memberPath + "/"
			for existingPath := range seen {
				if strings.HasPrefix(existingPath, prefix) {
					return archiveSummary{}, fmt.Errorf("regular file %q conflicts with a child member", memberPath)
				}
			}
		}

		if onEntry != nil {
			if callbackErr := onEntry(header, memberPath, isRoot, tape); callbackErr != nil {
				return archiveSummary{}, callbackErr
			}
		} else if header.Size > 0 {
			copied, copyErr := io.Copy(io.Discard, tape)
			if copyErr != nil || copied != header.Size {
				return archiveSummary{}, fmt.Errorf("read archive member payload: copied %d of %d bytes: %w", copied, header.Size, copyErr)
			}
		}
	}

	padding := &zeroPaddingWriter{}
	if _, err = io.Copy(padding, compressed); err != nil {
		return archiveSummary{}, fmt.Errorf("validate gzip trailer: %w", err)
	}
	if err = compressed.Close(); err != nil {
		return archiveSummary{}, fmt.Errorf("close gzip stream: %w", err)
	}
	return summary, nil
}

func ensureDirectory(root string, relativePath string) error {
	current := root
	if relativePath == "." {
		return nil
	}
	for _, component := range strings.Split(relativePath, "/") {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			if err = os.Mkdir(current, 0o700); err != nil {
				return fmt.Errorf("create extraction directory: %w", err)
			}
			continue
		}
		if err != nil {
			return fmt.Errorf("inspect extraction directory: %w", err)
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("extraction path contains a non-directory component")
		}
	}
	return nil
}

func validateEmptyDestination(destination string) error {
	info, err := os.Lstat(destination)
	if err != nil {
		return fmt.Errorf("inspect extraction destination: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("extraction destination must be a real directory")
	}
	entries, err := os.ReadDir(destination)
	if err != nil {
		return fmt.Errorf("read extraction destination: %w", err)
	}
	if len(entries) != 0 {
		return errors.New("extraction destination must be empty")
	}
	return os.Chmod(destination, 0o700)
}

func extractArchive(archiveFile *os.File, destination string, limits archiveLimits) (archiveSummary, error) {
	if err := validateLimits(limits); err != nil {
		return archiveSummary{}, err
	}
	if err := validateEmptyDestination(destination); err != nil {
		return archiveSummary{}, err
	}

	// Validate the complete stream before creating any member. Both passes use the same open file
	// descriptor and parser, so a path replacement cannot create a check/extract discrepancy.
	if _, err := archiveFile.Seek(0, io.SeekStart); err != nil {
		return archiveSummary{}, fmt.Errorf("seek archive: %w", err)
	}
	summary, err := walkArchive(archiveFile, limits, nil)
	if err != nil {
		return archiveSummary{}, err
	}
	if _, err = archiveFile.Seek(0, io.SeekStart); err != nil {
		return archiveSummary{}, fmt.Errorf("rewind archive: %w", err)
	}

	extracted, err := walkArchive(archiveFile, limits, func(header *tar.Header, memberPath string, isRoot bool, contents io.Reader) error {
		if isRoot {
			return nil
		}
		if header.Typeflag == tar.TypeDir {
			return ensureDirectory(destination, memberPath)
		}
		if err := ensureDirectory(destination, path.Dir(memberPath)); err != nil {
			return err
		}
		target := filepath.Join(destination, filepath.FromSlash(memberPath))
		file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return fmt.Errorf("create extracted file: %w", err)
		}
		copied, copyErr := io.Copy(file, contents)
		closeErr := file.Close()
		if copyErr != nil || copied != header.Size {
			return fmt.Errorf("extract member: copied %d of %d bytes: %w", copied, header.Size, copyErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close extracted file: %w", closeErr)
		}
		return nil
	})
	if err != nil {
		return archiveSummary{}, err
	}
	if extracted != summary {
		return archiveSummary{}, errors.New("archive changed between validation and extraction")
	}
	return summary, nil
}

func parseChecksumLine(line string) (string, string, error) {
	escaped := strings.HasPrefix(line, "\\")
	if escaped {
		line = strings.TrimPrefix(line, "\\")
	}
	if len(line) < 67 || line[64] != ' ' || (line[65] != ' ' && line[65] != '*') {
		return "", "", errors.New("manifest line has an invalid sha256sum format")
	}
	digest := line[:64]
	if _, err := hex.DecodeString(digest); err != nil || strings.ToLower(digest) != digest {
		return "", "", errors.New("manifest line has an invalid lowercase SHA-256")
	}
	name := line[66:]
	if escaped {
		var decoded strings.Builder
		for index := 0; index < len(name); index++ {
			if name[index] != '\\' {
				decoded.WriteByte(name[index])
				continue
			}
			index++
			if index >= len(name) {
				return "", "", errors.New("manifest filename ends in an incomplete escape")
			}
			switch name[index] {
			case '\\':
				decoded.WriteByte('\\')
			case 'n':
				decoded.WriteByte('\n')
			case 'r':
				decoded.WriteByte('\r')
			default:
				return "", "", errors.New("manifest filename uses an unknown escape")
			}
		}
		name = decoded.String()
	}
	normalized, isRoot, err := normalizeArchivePath(name, false)
	if err != nil || isRoot {
		return "", "", errors.New("manifest filename is unsafe")
	}
	return digest, normalized, nil
}

func hashFile(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	var digest hash.Hash = sha256.New()
	if _, err = io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func manifestSizeLimit(maxEntries uint64) (uint64, error) {
	if maxEntries == 0 || maxEntries > hardMaxMembers {
		return 0, fmt.Errorf("manifest entry limit must be between 1 and %d", hardMaxMembers)
	}
	if maxEntries > hardMaxManifestSize/uint64(maxManifestLineSize) {
		return hardMaxManifestSize, nil
	}
	return maxEntries * uint64(maxManifestLineSize), nil
}

func verifyManifest(root string, manifestName string, maxEntries uint64) (int, error) {
	maxManifestSize, err := manifestSizeLimit(maxEntries)
	if err != nil {
		return 0, err
	}
	manifestPath := filepath.Join(root, filepath.FromSlash(manifestName))
	manifestInfo, err := os.Lstat(manifestPath)
	if err != nil || !manifestInfo.Mode().IsRegular() || manifestInfo.Mode()&os.ModeSymlink != 0 {
		return 0, errors.New("checksum manifest must be a regular file")
	}
	if manifestInfo.Size() < 0 || uint64(manifestInfo.Size()) > maxManifestSize {
		return 0, fmt.Errorf("checksum manifest exceeds byte limit %d", maxManifestSize)
	}
	manifest, err := os.Open(manifestPath)
	if err != nil {
		return 0, err
	}
	defer manifest.Close()

	expected := make(map[string]string)
	scanner := bufio.NewScanner(manifest)
	scanner.Buffer(make([]byte, 4096), maxManifestLineSize)
	for scanner.Scan() {
		if uint64(len(expected)) >= maxEntries {
			return 0, fmt.Errorf("checksum manifest exceeds entry limit %d", maxEntries)
		}
		digest, filename, parseErr := parseChecksumLine(scanner.Text())
		if parseErr != nil {
			return 0, parseErr
		}
		if filename == manifestName {
			return 0, errors.New("checksum manifest may not include itself")
		}
		if _, duplicate := expected[filename]; duplicate {
			return 0, fmt.Errorf("checksum manifest contains duplicate path %q", filename)
		}
		expected[filename] = digest
	}
	if err = scanner.Err(); err != nil {
		return 0, fmt.Errorf("read checksum manifest: %w", err)
	}
	if len(expected) == 0 {
		return 0, errors.New("checksum manifest is empty")
	}

	actualCount := uint64(0)
	err = filepath.Walk(root, func(filename string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, relErr := filepath.Rel(root, filename)
		if relErr != nil {
			return relErr
		}
		relative = filepath.ToSlash(relative)
		if relative == "." || relative == manifestName {
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return fmt.Errorf("extracted payload contains forbidden type at %q", relative)
		}
		if info.IsDir() {
			return nil
		}
		actualCount++
		if actualCount > maxEntries {
			return fmt.Errorf("payload exceeds manifest entry limit %d", maxEntries)
		}
		expectedDigest, exists := expected[relative]
		if !exists {
			return fmt.Errorf("payload contains file missing from checksum manifest %q", relative)
		}
		digest, hashErr := hashFile(filename)
		if hashErr != nil {
			return hashErr
		}
		if digest != expectedDigest {
			return fmt.Errorf("checksum mismatch for %q", relative)
		}
		delete(expected, relative)
		return nil
	})
	if err != nil {
		return 0, err
	}
	if len(expected) != 0 {
		for filename := range expected {
			return 0, fmt.Errorf("checksum manifest references missing file %q", filename)
		}
	}
	return int(actualCount), nil
}

func parseUint(name string, raw string) (uint64, error) {
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be an unsigned decimal integer", name)
	}
	return value, nil
}

func runExtract(arguments []string) error {
	flags := flag.NewFlagSet("extract", flag.ContinueOnError)
	archivePath := flags.String("archive", "", "path to a gzip-compressed tar archive")
	destination := flags.String("destination", "", "existing empty extraction directory")
	memberLimit := flags.String("max-members", "200000", "maximum archive members")
	expandedLimit := flags.String("max-expanded-bytes", "107374182400", "maximum declared regular-file bytes")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if flags.NArg() != 0 || *archivePath == "" || *destination == "" {
		return errors.New("extract requires --archive and --destination")
	}
	maxMembers, err := parseUint("max-members", *memberLimit)
	if err != nil {
		return err
	}
	maxExpandedSize, err := parseUint("max-expanded-bytes", *expandedLimit)
	if err != nil {
		return err
	}
	archive, err := os.Open(*archivePath)
	if err != nil {
		return err
	}
	defer archive.Close()
	summary, err := extractArchive(archive, *destination, archiveLimits{maxMembers: maxMembers, maxExpandedSize: maxExpandedSize})
	if err != nil {
		return err
	}
	fmt.Printf("archive accepted: members=%d expandedBytes=%d\n", summary.members, summary.expandedSize)
	return nil
}

func runInspect(arguments []string) error {
	flags := flag.NewFlagSet("inspect", flag.ContinueOnError)
	archivePath := flags.String("archive", "", "path to a gzip-compressed tar archive")
	memberLimit := flags.String("max-members", "200000", "maximum archive members")
	expandedLimit := flags.String("max-expanded-bytes", "107374182400", "maximum declared regular-file bytes")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if flags.NArg() != 0 || *archivePath == "" {
		return errors.New("inspect requires --archive")
	}
	maxMembers, err := parseUint("max-members", *memberLimit)
	if err != nil {
		return err
	}
	maxExpandedSize, err := parseUint("max-expanded-bytes", *expandedLimit)
	if err != nil {
		return err
	}
	limits := archiveLimits{maxMembers: maxMembers, maxExpandedSize: maxExpandedSize}
	if err = validateLimits(limits); err != nil {
		return err
	}
	archive, err := os.Open(*archivePath)
	if err != nil {
		return err
	}
	defer archive.Close()
	summary, err := walkArchive(archive, limits, nil)
	if err != nil {
		return err
	}
	fmt.Printf("archive accepted: members=%d expandedBytes=%d\n", summary.members, summary.expandedSize)
	return nil
}

func runVerifyManifest(arguments []string) error {
	flags := flag.NewFlagSet("verify-manifest", flag.ContinueOnError)
	root := flags.String("root", "", "extracted payload root")
	manifestName := flags.String("manifest", "manifest.sha256", "relative checksum manifest path")
	entryLimit := flags.String("max-entries", "200000", "maximum checksum manifest entries")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if flags.NArg() != 0 || *root == "" {
		return errors.New("verify-manifest requires --root")
	}
	normalized, isRoot, err := normalizeArchivePath(*manifestName, false)
	if err != nil || isRoot || normalized != *manifestName {
		return errors.New("manifest path must be canonical and relative")
	}
	maxEntries, err := parseUint("max-entries", *entryLimit)
	if err != nil {
		return err
	}
	count, err := verifyManifest(*root, normalized, maxEntries)
	if err != nil {
		return err
	}
	fmt.Printf("checksum manifest accepted: files=%d\n", count)
	return nil
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: archive-guard inspect|extract|verify-manifest [options]")
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "inspect":
		err = runInspect(os.Args[2:])
	case "extract":
		err = runExtract(os.Args[2:])
	case "verify-manifest":
		err = runVerifyManifest(os.Args[2:])
	default:
		err = errors.New("unknown archive-guard command")
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "archive rejected: %v\n", err)
		os.Exit(4)
	}
}
