'use strict';

/**
 * Tests unitaires pour storage.service.js (lot D, finding C2 audit 2026-09).
 * @aws-sdk/client-s3 et @aws-sdk/s3-request-presigner sont mockés — aucun
 * appel réseau réel n'est effectué ici. Pour une validation réelle contre un
 * S3-compatible (MinIO), voir le script scratchpad de validation manuelle
 * décrit dans le rapport du lot D.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const PutObjectCommand    = jest.fn((input) => ({ __cmd: 'PutObject', input }));
  const GetObjectCommand    = jest.fn((input) => ({ __cmd: 'GetObject', input }));
  const DeleteObjectCommand = jest.fn((input) => ({ __cmd: 'DeleteObject', input }));
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  };
});

const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Alias conservé pour la lisibilité des assertions ci-dessous — même
// référence que le mock utilisé par le module (résiste à jest.resetModules()
// car défini en dehors de la factory jest.mock, contrairement à un
// `jest.fn()` déclaré directement dans le corps de la factory).
const getSignedUrl = mockGetSignedUrl;

const ANCIEN_ENV = process.env;

function reimporter() {
  jest.resetModules();
  return require('../../src/infrastructure/storage/storage.service');
}

describe('storage.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    process.env = {
      ...ANCIEN_ENV,
      S3_ENDPOINT:   'http://localhost:9000',
      S3_ACCESS_KEY: 'minioadmin',
      S3_SECRET_KEY: 'minioadmin-secret',
      S3_BUCKET:     'ecolemanager-bulletins',
    };
  });

  afterAll(() => {
    process.env = ANCIEN_ENV;
  });

  describe('isDisponible', () => {
    test('retourne true quand les 4 variables sont présentes', () => {
      const { isDisponible } = reimporter();
      expect(isDisponible()).toBe(true);
    });

    test('retourne false si une variable manque', () => {
      delete process.env.S3_BUCKET;
      const { isDisponible } = reimporter();
      expect(isDisponible()).toBe(false);
    });
  });

  describe('uploadFichier', () => {
    test('retourne la clé S3 (pas une URL) en cas de succès', async () => {
      mockSend.mockResolvedValueOnce({});
      const { uploadFichier } = reimporter();

      const cle = await uploadFichier('bulletins/etab-1/periode-1/bul-1.pdf', Buffer.from('pdf'), 'application/pdf');

      expect(cle).toBe('bulletins/etab-1/periode-1/bul-1.pdf');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('retourne null si le client S3 rejette', async () => {
      mockSend.mockRejectedValueOnce(new Error('bucket introuvable'));
      const { uploadFichier } = reimporter();

      const cle = await uploadFichier('bulletins/x.pdf', Buffer.from('pdf'), 'application/pdf');

      expect(cle).toBeNull();
    });

    test('retourne null si le storage n\'est pas configuré', async () => {
      delete process.env.S3_ENDPOINT;
      const { uploadFichier } = reimporter();

      const cle = await uploadFichier('bulletins/x.pdf', Buffer.from('pdf'), 'application/pdf');

      expect(cle).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('getUrlSignee', () => {
    test('retourne une URL signée via getSignedUrl', async () => {
      getSignedUrl.mockResolvedValueOnce('https://minio.local/bucket/key?sig=abc');
      const { getUrlSignee } = reimporter();

      const url = await getUrlSignee('bulletins/x.pdf', 900);

      expect(url).toBe('https://minio.local/bucket/key?sig=abc');
      expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ __cmd: 'GetObject' }), { expiresIn: 900 });
    });

    test('retourne null si la signature échoue', async () => {
      getSignedUrl.mockRejectedValueOnce(new Error('échec signature'));
      const { getUrlSignee } = reimporter();

      const url = await getUrlSignee('bulletins/x.pdf');

      expect(url).toBeNull();
    });

    test('retourne null si le storage n\'est pas configuré', async () => {
      delete process.env.S3_ACCESS_KEY;
      const { getUrlSignee } = reimporter();

      const url = await getUrlSignee('bulletins/x.pdf');

      expect(url).toBeNull();
      expect(getSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('supprimerFichier', () => {
    test('appelle DeleteObjectCommand sans lever d\'exception', async () => {
      mockSend.mockResolvedValueOnce({});
      const { supprimerFichier } = reimporter();

      await expect(supprimerFichier('bulletins/x.pdf')).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
