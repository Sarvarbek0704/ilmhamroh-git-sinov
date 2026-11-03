// xatolar.ts — xato iyerarxiyasi. IlovaXatosi — KUTILGAN (operational) xatolar: mijozga aniq javob, log darajasi warn emas.
// Undan meros olmagan har qanday xato (TypeError, DB uzilishi…) — dasturchi xatosi yoki kutilmagan holat: 500, log error, tafsilot yashiriladi

/** Validatsiya xatosi tafsiloti: qaysi joy (body.matn, query.limit) va nima noto'g'ri */
export type MaydonXatosi = { joy: string; xabar: string };

export type XatoSozlamasi = ErrorOptions & {
  /** mashina o'qiydigan kod — katalogdagi type URI shundan; yo'q bo'lsa type "about:blank" */
  kod?: string;
  /** odam o'qiydigan qisqa sarlavha (har kod uchun bir xil) */
  sarlavha?: string;
  xatolar?: MaydonXatosi[];
  /** javobga qo'shimcha HTTP sarlavhalar (Retry-After, Allow, ETag …) */
  httpSarlavhalar?: Record<string, string>;
};

export class IlovaXatosi extends Error {
  readonly holat: number;
  readonly kod: string | undefined;
  readonly sarlavha: string | undefined;
  readonly xatolar: MaydonXatosi[] | undefined;
  readonly httpSarlavhalar: Record<string, string>;
  /** kutilgan xato — jarayon holati buzilmagan, ishlashda davom etish xavfsiz */
  readonly operatsion = true;

  /** @param xabar Problem Details `detail` — aynan shu holat haqida */
  constructor(holat: number, xabar: string, sozlama: XatoSozlamasi = {}) {
    super(xabar, sozlama.cause === undefined ? undefined : { cause: sozlama.cause });
    this.name = new.target.name; // voris klass nomi: "TopilmadiXatosi"
    this.holat = holat;
    this.kod = sozlama.kod;
    this.sarlavha = sozlama.sarlavha;
    this.xatolar = sozlama.xatolar;
    this.httpSarlavhalar = sozlama.httpSarlavhalar ?? {};
  }
}

/** 400: query yoki yo'l parametri noto'g'ri */
export class ParametrXatosi extends IlovaXatosi {
  constructor(xabar: string, xatolar?: MaydonXatosi[]) {
    super(400, xabar, xatolar === undefined ? { kod: "parametr", sarlavha: "Parametr noto'g'ri" } : { kod: "parametr", sarlavha: "Parametr noto'g'ri", xatolar });
  }
}

/** 422: so'rov tanasi JSON, lekin qoidaga mos emas */
export class ValidatsiyaXatosi extends IlovaXatosi {
  constructor(xatolar: MaydonXatosi[], xabar = xatolar.length === 1 ? (xatolar[0]?.xabar ?? "") : `${String(xatolar.length)} ta maydon noto'g'ri`) {
    super(422, xabar, { kod: "validatsiya", sarlavha: "So'rov ma'lumoti noto'g'ri", xatolar });
  }
}

export class TopilmadiXatosi extends IlovaXatosi {
  constructor(xabar: string, kod?: string, sarlavha?: string) {
    super(404, xabar, kod === undefined ? {} : sarlavha === undefined ? { kod } : { kod, sarlavha });
  }
}

/** 409: holat bilan to'qnashuv (ro'yxat to'lgan, so'rov hali bajarilmoqda) */
export class KonfliktXatosi extends IlovaXatosi {
  constructor(xabar: string, sozlama: XatoSozlamasi & { kod: string }) {
    super(409, xabar, sozlama);
  }
}

/** 412: If-Match versiyasi eskirgan */
export class ShartXatosi extends IlovaXatosi {
  constructor(xabar: string, joriyEtag?: string) {
    super(412, xabar, joriyEtag === undefined ? { kod: "versiya-mos-emas", sarlavha: "Vazifa o'zgarib ketgan" } : { kod: "versiya-mos-emas", sarlavha: "Vazifa o'zgarib ketgan", httpSarlavhalar: { ETag: joriyEtag } });
  }
}

export class MetodYoqXatosi extends IlovaXatosi {
  constructor(metod: string, allow: string) {
    super(405, `${metod} bu manzilda yo'q`, { httpSarlavhalar: { Allow: allow } });
  }
}
